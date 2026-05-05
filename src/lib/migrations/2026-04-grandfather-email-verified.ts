/**
 * One-time grandfather migration: set `emailVerified = true` for user rows
 * that existed before the release cutoff.
 *
 * Why: Phase B of auth-flow-hardening flips
 * `emailAndPassword.requireEmailVerification` to true, which would lock every
 * pre-existing user out of the dashboard on deploy because their accounts were
 * created before we ever dispatched a verification email. Rather than spam
 * every user with a forced re-verification, we grandfather them in: anyone
 * who signed up before the migration's cutoff gets `emailVerified = true` and
 * can keep signing in; anyone who signed up AFTER the cutoff goes through the
 * normal verification flow.
 *
 * Contract:
 * - Idempotent via a marker row in `gibson_migrations`. Running the migration
 *   a second (or Nth) time is a no-op.
 * - Only updates rows where `emailVerified IS DISTINCT FROM true` — we never
 *   "downgrade" a verified user, we never touch users who signed up post-cutoff,
 *   and we only issue one UPDATE.
 * - Cutoff resolution: `DASHBOARD_EMAIL_VERIFICATION_CUTOFF` env var (ISO8601),
 *   falling back to `NOW()` on first run. Whichever we use is persisted to the
 *   marker row so future runs can audit exactly which cutoff was applied.
 *
 * The dashboard's Postgres schema (Auth.js adapter) is camelCase with quoted
 * identifiers:
 *   table: "user", columns: "emailVerified", "createdAt"
 *
 * This module is server-only. It is invoked from `src/lib/auth-server.ts`
 * after the Auth.js adapter runs its own schema migrations, and any failure
 * is caught so a grandfather-migration error cannot crash dashboard startup.
 */

import type { Pool } from "pg";

export const MIGRATION_NAME = "2026-04-grandfather-email-verified";
export const MIGRATION_TABLE = "gibson_migrations";

export interface GrandfatherMigrationResult {
  /** True when the migration actually ran (first invocation). */
  applied: boolean;
  /** Number of user rows updated. Always 0 on idempotent no-ops. */
  updatedRows: number;
  /** The cutoff timestamp used (either from env or first-run NOW()). */
  cutoff: Date;
  /** When the migration was first applied (from the marker row). */
  appliedAt: Date;
}

/**
 * Resolve the cutoff from env, if set.
 *
 * Returns `null` when the env var is unset or unparseable — the caller then
 * uses `NOW()` as the cutoff. A malformed value is logged and ignored rather
 * than thrown so operators with a typo don't block startup.
 */
function resolveEnvCutoff(): Date | null {
  const raw = process.env.DASHBOARD_EMAIL_VERIFICATION_CUTOFF;
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(
      `[grandfather-email-verified] DASHBOARD_EMAIL_VERIFICATION_CUTOFF='${raw}' is not a valid ISO8601 timestamp; falling back to NOW()`
    );
    return null;
  }
  return parsed;
}

/**
 * Ensure the `gibson_migrations` table exists.
 *
 * Created with `IF NOT EXISTS` so concurrent pods (replicas) racing on
 * startup don't fight each other. Columns match the marker we write later.
 */
async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cutoff_used TIMESTAMPTZ NOT NULL
    )
  `);
}

/**
 * Read the existing marker row (if any).
 */
async function readMarker(pool: Pool): Promise<{ applied_at: Date; cutoff_used: Date } | null> {
  const res = await pool.query<{ applied_at: Date; cutoff_used: Date }>(
    `SELECT applied_at, cutoff_used FROM "${MIGRATION_TABLE}" WHERE name = $1 LIMIT 1`,
    [MIGRATION_NAME]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0] ?? null;
}

/**
 * Run the one-time grandfather migration.
 *
 * Safe to call unconditionally on every startup: the idempotency marker in
 * `gibson_migrations` short-circuits all subsequent invocations.
 */
export async function runGrandfatherEmailVerifiedMigration(
  pool: Pool
): Promise<GrandfatherMigrationResult> {
  await ensureMigrationsTable(pool);

  const existing = await readMarker(pool);
  if (existing) {
    return {
      applied: false,
      updatedRows: 0,
      cutoff: new Date(existing.cutoff_used),
      appliedAt: new Date(existing.applied_at),
    };
  }

  // First run: resolve cutoff (env → NOW()) and flip pre-cutoff unverified users.
  // We compute NOW() via a SQL expression so we're consistent with the DB's clock
  // in the UPDATE — cutting off users based on a local-JS clock that might skew
  // against Postgres would be surprising.
  const envCutoff = resolveEnvCutoff();

  // Insert the marker FIRST (inside a single transaction with the UPDATE) so
  // that if the UPDATE fails, the marker row is rolled back and the migration
  // gets retried on next boot. We use `ON CONFLICT DO NOTHING` on the marker
  // so a concurrent replica racing us loses gracefully — whoever wins commits
  // the UPDATE, whoever loses sees the marker on the next read and no-ops.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the marker row for this migration name so two racing pods don't both
    // try to run the UPDATE. The second pod will block here, then read the
    // marker on its retry and no-op.
    const insertRes = await client.query<{ cutoff_used: Date; applied_at: Date }>(
      `INSERT INTO "${MIGRATION_TABLE}" (name, applied_at, cutoff_used)
       VALUES ($1, NOW(), COALESCE($2::timestamptz, NOW()))
       ON CONFLICT (name) DO NOTHING
       RETURNING applied_at, cutoff_used`,
      [MIGRATION_NAME, envCutoff ? envCutoff.toISOString() : null]
    );

    if (insertRes.rowCount === 0) {
      // Someone else raced us to the marker. Roll back and let the caller see
      // the idempotent-no-op path.
      await client.query("ROLLBACK");
      const remote = await readMarker(pool);
      return {
        applied: false,
        updatedRows: 0,
        cutoff: remote ? new Date(remote.cutoff_used) : new Date(),
        appliedAt: remote ? new Date(remote.applied_at) : new Date(),
      };
    }

    const marker = insertRes.rows[0]!;

    // Flip pre-cutoff unverified users. `IS DISTINCT FROM true` matches both
    // `false` and `NULL` without relying on schema-level defaults.
    const updateRes = await client.query(
      `UPDATE "user"
       SET "emailVerified" = true
       WHERE "emailVerified" IS DISTINCT FROM true
         AND "createdAt" < $1`,
      [marker.cutoff_used]
    );

    await client.query("COMMIT");

    return {
      applied: true,
      updatedRows: updateRes.rowCount ?? 0,
      cutoff: new Date(marker.cutoff_used),
      appliedAt: new Date(marker.applied_at),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
