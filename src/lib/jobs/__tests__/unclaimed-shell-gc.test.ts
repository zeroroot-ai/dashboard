/**
 * @vitest-environment node
 *
 * Unit tests for runUnclaimedShellGC.
 *
 * These tests drive the function with a fake Pool that records every SQL
 * statement + bind. The SQL itself is treated as an opaque string; we assert
 * on the args bound to $1 (olderThanDays) and the sequence of queries (one
 * SELECT + N DELETEs). Row contents are supplied via the mocked pool so the
 * test never touches a real Postgres.
 *
 * Covered cases:
 *   1. Dry-run returns candidates without issuing DELETEs.
 *   2. Real run issues one DELETE per candidate and reports the ids.
 *   3. A DELETE failure on one row does not abort the remaining deletes.
 *   4. Empty result set short-circuits (no DELETEs even in non-dry-run).
 *   5. olderThanDays is bound to the SELECT as $1.
 *   6. Invalid olderThanDays throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

import { runUnclaimedShellGC } from "../unclaimed-shell-gc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryCall = { sql: string; params: unknown[] };

interface FakePoolOptions {
  selectRows?: Array<{ id: string; email: string; createdAt: Date }>;
  deleteFail?: Set<string>; // ids that should throw on delete
  selectThrows?: Error;
}

function makeFakePool(opts: FakePoolOptions = {}): {
  pool: Pool;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const selectRows = opts.selectRows ?? [];
  const deleteFail = opts.deleteFail ?? new Set<string>();

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) {
      if (opts.selectThrows) {
        throw opts.selectThrows;
      }
      return { rows: selectRows, rowCount: selectRows.length };
    }
    if (/^\s*DELETE/i.test(sql)) {
      const id = params[0] as string;
      if (deleteFail.has(id)) {
        throw new Error(`FK violation for ${id}`);
      }
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  // Narrow: we only touch .query on the Pool.
  const pool = { query } as unknown as Pool;
  return { pool, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runUnclaimedShellGC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run returns candidates without issuing DELETEs", async () => {
    const rows = [
      { id: "u1", email: "a@example.com", createdAt: new Date("2025-01-01") },
      { id: "u2", email: "b@example.com", createdAt: new Date("2025-02-01") },
    ];
    const { pool, calls } = makeFakePool({ selectRows: rows });

    const result = await runUnclaimedShellGC({ pool, dryRun: true });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].id).toBe("u1");
    expect(result.candidates[1].email).toBe("b@example.com");
    expect(result.deleted).toEqual([]);

    // Exactly one query, and it is the SELECT (no DELETE).
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/SELECT/i);
  });

  it("real run issues DELETE per candidate and reports the deleted ids", async () => {
    const rows = [
      { id: "u1", email: "a@example.com", createdAt: new Date("2025-01-01") },
      { id: "u2", email: "b@example.com", createdAt: new Date("2025-02-01") },
    ];
    const { pool, calls } = makeFakePool({ selectRows: rows });

    const result = await runUnclaimedShellGC({ pool, dryRun: false });

    expect(result.candidates).toHaveLength(2);
    expect(result.deleted).toEqual(["u1", "u2"]);
    // One SELECT + two DELETE calls.
    expect(calls).toHaveLength(3);
    expect(calls[0].sql).toMatch(/SELECT/i);
    expect(calls[1].sql).toMatch(/DELETE/i);
    expect(calls[1].params).toEqual(["u1"]);
    expect(calls[2].sql).toMatch(/DELETE/i);
    expect(calls[2].params).toEqual(["u2"]);
  });

  it("continues deleting after a per-row failure", async () => {
    const rows = [
      { id: "u1", email: "a@example.com", createdAt: new Date("2025-01-01") },
      { id: "u2", email: "b@example.com", createdAt: new Date("2025-02-01") },
      { id: "u3", email: "c@example.com", createdAt: new Date("2025-03-01") },
    ];
    const { pool } = makeFakePool({
      selectRows: rows,
      deleteFail: new Set(["u2"]),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runUnclaimedShellGC({ pool, dryRun: false });

    expect(result.candidates.map((c) => c.id)).toEqual(["u1", "u2", "u3"]);
    // u2's delete threw; u1 and u3 were still processed.
    expect(result.deleted).toEqual(["u1", "u3"]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("empty candidate list produces no DELETE queries", async () => {
    const { pool, calls } = makeFakePool({ selectRows: [] });

    const result = await runUnclaimedShellGC({ pool, dryRun: false });

    expect(result.candidates).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(calls).toHaveLength(1); // SELECT only
  });

  it("binds olderThanDays to $1 on the SELECT", async () => {
    const { pool, calls } = makeFakePool({ selectRows: [] });
    await runUnclaimedShellGC({ pool, dryRun: true, olderThanDays: 90 });
    expect(calls[0].params).toEqual([90]);

    calls.length = 0;
    await runUnclaimedShellGC({ pool, dryRun: true, olderThanDays: 30 });
    expect(calls[0].params).toEqual([30]);
  });

  it("uses the default 30-day threshold when olderThanDays is not provided", async () => {
    const { pool, calls } = makeFakePool({ selectRows: [] });
    await runUnclaimedShellGC({ pool, dryRun: true });
    expect(calls[0].params).toEqual([30]);
  });

  it("rejects invalid olderThanDays values", async () => {
    const { pool } = makeFakePool({ selectRows: [] });
    await expect(
      runUnclaimedShellGC({ pool, dryRun: true, olderThanDays: -1 }),
    ).rejects.toThrow(/non-negative/i);
    await expect(
      runUnclaimedShellGC({
        pool,
        dryRun: true,
        olderThanDays: Number.NaN,
      }),
    ).rejects.toThrow(/non-negative/i);
  });

  it("propagates SELECT errors to the caller", async () => {
    const { pool } = makeFakePool({
      selectThrows: new Error("connection refused"),
    });
    await expect(
      runUnclaimedShellGC({ pool, dryRun: true }),
    ).rejects.toThrow(/connection refused/);
  });

  // The SELECT body is part of the contract — both the .ts implementation
  // and the .mjs CronJob entrypoint must apply identical filters. Guard
  // against silent drift by pinning the three predicate fragments.
  it("SELECT has the shell-user predicate fragments", async () => {
    const { pool, calls } = makeFakePool({ selectRows: [] });
    await runUnclaimedShellGC({ pool, dryRun: true });
    const sql = calls[0].sql;
    expect(sql).toMatch(/"user"/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]+"account"/);
    expect(sql).toMatch(/"providerId" = 'credential'/);
    expect(sql).toMatch(/password IS NOT NULL/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]+"member"/);
    expect(sql).toMatch(/INTERVAL/);
  });
});
