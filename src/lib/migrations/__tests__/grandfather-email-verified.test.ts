/**
 * @vitest-environment node
 *
 * Tests for the grandfather-email-verified migration.
 *
 * All Postgres I/O is mocked: we inject a fake `pg.Pool` whose behaviour is
 * driven by a minimal in-memory "database" (user rows + migration marker).
 * The assertions verify:
 *   - First run: pre-cutoff unverified users are flipped, post-cutoff users
 *     are untouched, and a marker row is inserted.
 *   - Second run: no UPDATE is issued (marker detected), result reports
 *     applied=false / updatedRows=0.
 *   - Env cutoff overrides NOW() when set and valid ISO8601.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MIGRATION_NAME,
  MIGRATION_TABLE,
  runGrandfatherEmailVerifiedMigration,
} from "../2026-04-grandfather-email-verified";

// ---------------------------------------------------------------------------
// In-memory Postgres fake
// ---------------------------------------------------------------------------

interface FakeUserRow {
  id: string;
  email: string;
  emailVerified: boolean | null;
  createdAt: Date;
}

interface FakeMarkerRow {
  name: string;
  applied_at: Date;
  cutoff_used: Date;
}

/**
 * Minimal handler for the exact SQL statements the migration issues.
 * We intentionally DO NOT build a full SQL parser — we match by substring and
 * keep the assertions tight. If the migration changes its SQL shape, this
 * fake will fail loudly.
 */
function makeFakePool(state: {
  users: FakeUserRow[];
  markers: FakeMarkerRow[];
  now: () => Date;
  /** Records every UPDATE "user" invocation — used to assert no-op on re-run. */
  updateCalls: { cutoff: Date; rowCount: number }[];
}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.trim();

    if (s.startsWith("CREATE TABLE IF NOT EXISTS")) {
      return { rowCount: 0, rows: [] };
    }

    if (s.startsWith("SELECT applied_at, cutoff_used FROM")) {
      const name = params?.[0] as string;
      const row = state.markers.find((m) => m.name === name) ?? null;
      return {
        rowCount: row ? 1 : 0,
        rows: row ? [{ applied_at: row.applied_at, cutoff_used: row.cutoff_used }] : [],
      };
    }

    if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
      return { rowCount: 0, rows: [] };
    }

    if (s.startsWith(`INSERT INTO "${MIGRATION_TABLE}"`)) {
      const name = params?.[0] as string;
      const envCutoff = params?.[1] as string | null;
      if (state.markers.some((m) => m.name === name)) {
        // ON CONFLICT DO NOTHING path.
        return { rowCount: 0, rows: [] };
      }
      const cutoff = envCutoff ? new Date(envCutoff) : state.now();
      const appliedAt = state.now();
      const marker: FakeMarkerRow = { name, applied_at: appliedAt, cutoff_used: cutoff };
      state.markers.push(marker);
      return {
        rowCount: 1,
        rows: [{ applied_at: appliedAt, cutoff_used: cutoff }],
      };
    }

    if (s.startsWith(`UPDATE "user"`)) {
      const cutoff = params?.[0] as Date;
      let updated = 0;
      for (const u of state.users) {
        if (u.emailVerified !== true && u.createdAt < cutoff) {
          u.emailVerified = true;
          updated += 1;
        }
      }
      state.updateCalls.push({ cutoff, rowCount: updated });
      return { rowCount: updated, rows: [] };
    }

    throw new Error(`Unexpected SQL in fake pool: ${s}`);
  });

  const connect = vi.fn(async () => ({
    query,
    release: vi.fn(),
  }));

  return {
    query,
    connect,
  } as unknown as import("pg").Pool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGrandfatherEmailVerifiedMigration", () => {
  const PRE_CUTOFF = new Date("2026-03-01T00:00:00.000Z");
  const POST_CUTOFF = new Date("2026-05-01T00:00:00.000Z");
  const NOW = new Date("2026-04-15T12:00:00.000Z");

  beforeEach(() => {
    delete process.env.DASHBOARD_EMAIL_VERIFICATION_CUTOFF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flips ONLY pre-cutoff unverified users on first run and records marker", async () => {
    const state = {
      users: [
        { id: "u-pre", email: "pre@test", emailVerified: false, createdAt: PRE_CUTOFF },
        { id: "u-post", email: "post@test", emailVerified: false, createdAt: POST_CUTOFF },
        // A user created pre-cutoff but already verified — must not be touched
        // by the UPDATE (rowCount only counts changes).
        { id: "u-pre-ok", email: "preok@test", emailVerified: true, createdAt: PRE_CUTOFF },
      ] as FakeUserRow[],
      markers: [] as FakeMarkerRow[],
      now: () => NOW,
      updateCalls: [] as { cutoff: Date; rowCount: number }[],
    };
    const pool = makeFakePool(state);

    const result = await runGrandfatherEmailVerifiedMigration(pool);

    expect(result.applied).toBe(true);
    expect(result.updatedRows).toBe(1);

    const pre = state.users.find((u) => u.id === "u-pre")!;
    const post = state.users.find((u) => u.id === "u-post")!;
    const preOk = state.users.find((u) => u.id === "u-pre-ok")!;
    expect(pre.emailVerified).toBe(true); // flipped
    expect(post.emailVerified).toBe(false); // untouched — post-cutoff
    expect(preOk.emailVerified).toBe(true); // already true, still true

    expect(state.markers).toHaveLength(1);
    expect(state.markers[0]!.name).toBe(MIGRATION_NAME);
    expect(state.updateCalls).toHaveLength(1);
  });

  it("is a no-op on second run (marker present, no UPDATE issued)", async () => {
    const state = {
      users: [
        { id: "u-pre", email: "pre@test", emailVerified: false, createdAt: PRE_CUTOFF },
      ] as FakeUserRow[],
      markers: [] as FakeMarkerRow[],
      now: () => NOW,
      updateCalls: [] as { cutoff: Date; rowCount: number }[],
    };
    const pool = makeFakePool(state);

    // First run flips u-pre.
    const first = await runGrandfatherEmailVerifiedMigration(pool);
    expect(first.applied).toBe(true);
    expect(first.updatedRows).toBe(1);
    expect(state.updateCalls).toHaveLength(1);

    // Seed a fresh unverified user AFTER the first run — a second invocation
    // MUST NOT touch them because the marker short-circuits the migration.
    state.users.push({
      id: "u-late",
      email: "late@test",
      emailVerified: false,
      createdAt: PRE_CUTOFF,
    });

    const second = await runGrandfatherEmailVerifiedMigration(pool);
    expect(second.applied).toBe(false);
    expect(second.updatedRows).toBe(0);

    // No additional UPDATE was issued — the late-seeded unverified row is
    // still unverified.
    expect(state.updateCalls).toHaveLength(1);
    expect(state.users.find((u) => u.id === "u-late")!.emailVerified).toBe(false);
  });

  it("honours DASHBOARD_EMAIL_VERIFICATION_CUTOFF env override", async () => {
    const customCutoff = new Date("2026-02-15T00:00:00.000Z");
    process.env.DASHBOARD_EMAIL_VERIFICATION_CUTOFF = customCutoff.toISOString();

    const BEFORE_CUSTOM = new Date("2026-01-01T00:00:00.000Z");
    const AFTER_CUSTOM = new Date("2026-03-10T00:00:00.000Z");

    const state = {
      users: [
        { id: "u-old", email: "old@test", emailVerified: false, createdAt: BEFORE_CUSTOM },
        { id: "u-newer", email: "newer@test", emailVerified: false, createdAt: AFTER_CUSTOM },
      ] as FakeUserRow[],
      markers: [] as FakeMarkerRow[],
      now: () => NOW,
      updateCalls: [] as { cutoff: Date; rowCount: number }[],
    };
    const pool = makeFakePool(state);

    const result = await runGrandfatherEmailVerifiedMigration(pool);

    expect(result.applied).toBe(true);
    expect(result.updatedRows).toBe(1);
    // Cutoff should match the env var, not NOW().
    expect(result.cutoff.toISOString()).toBe(customCutoff.toISOString());

    expect(state.users.find((u) => u.id === "u-old")!.emailVerified).toBe(true);
    // The user created 2026-03-10 is AFTER the custom 2026-02-15 cutoff, so
    // they're not grandfathered in.
    expect(state.users.find((u) => u.id === "u-newer")!.emailVerified).toBe(false);
  });
});
