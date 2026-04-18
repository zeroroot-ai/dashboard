/**
 * Migration: add `provider_profiles` JSONB column to Better Auth's user table.
 *
 * Purpose:
 *   Stores provider-supplied profile claims (avatar_url, display_name, etc.)
 *   from the most-recent OAuth callback for each social provider. The column is
 *   nullable and unread by any code that pre-dates this migration, so the change
 *   is backwards-compatible — older dashboard pods keep working without touching
 *   the new column.
 *
 * Contract:
 *   - Idempotent: tracked via a marker row in `gibson_migrations`. Second call is
 *     a no-op regardless of which DB state it finds.
 *   - Forward only: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS provider_profiles JSONB NULL`.
 *   - Reverse: `ALTER TABLE "user" DROP COLUMN IF EXISTS provider_profiles` — run manually
 *     when rolling back code that reads this column; the runner does not automate reverse.
 *   - No required columns, no data backfill, no existing row is touched.
 *
 * Invoked from `src/lib/auth-server.ts` in the startup migration chain, after
 * Better Auth's own migrations and the grandfather-email-verified migration.
 * Failures are caught at the call site and logged without crashing startup.
 */

import type { Pool } from "pg";

export const MIGRATION_NAME = "2026-04-social-provider-profile";
export const MIGRATION_TABLE = "gibson_migrations";

export interface SocialProviderProfileMigrationResult {
  /** True when the migration actually ran (first invocation). */
  applied: boolean;
  /** ISO timestamp from the marker row (own appliedAt or pre-existing). */
  appliedAt: Date;
}

/**
 * Ensure the `gibson_migrations` tracking table exists.
 * Idempotent: uses `IF NOT EXISTS`.
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
async function readMarker(pool: Pool): Promise<{ applied_at: Date } | null> {
  const res = await pool.query<{ applied_at: Date }>(
    `SELECT applied_at FROM "${MIGRATION_TABLE}" WHERE name = $1 LIMIT 1`,
    [MIGRATION_NAME]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0] ?? null;
}

/**
 * Run the social-provider-profile migration.
 *
 * Safe to call unconditionally on every startup: the idempotency marker in
 * `gibson_migrations` short-circuits all subsequent invocations.
 */
export async function runSocialProviderProfileMigration(
  pool: Pool
): Promise<SocialProviderProfileMigrationResult> {
  await ensureMigrationsTable(pool);

  const existing = await readMarker(pool);
  if (existing) {
    return {
      applied: false,
      appliedAt: new Date(existing.applied_at),
    };
  }

  // First run: add the column then write the idempotency marker in one transaction.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert the marker first with ON CONFLICT DO NOTHING so a racing replica
    // loses gracefully. The winner then applies the DDL; the loser finds the
    // marker on its next read and no-ops.
    const insertRes = await client.query<{ applied_at: Date }>(
      `INSERT INTO "${MIGRATION_TABLE}" (name, applied_at, cutoff_used)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (name) DO NOTHING
       RETURNING applied_at`,
      [MIGRATION_NAME]
    );

    if (insertRes.rowCount === 0) {
      // Racing replica won — roll back and treat as already-applied.
      await client.query("ROLLBACK");
      const remote = await readMarker(pool);
      return {
        applied: false,
        appliedAt: remote ? new Date(remote.applied_at) : new Date(),
      };
    }

    // DDL: add the column if it doesn't already exist.
    // `IF NOT EXISTS` makes this safe even if a prior partial run added the column.
    await client.query(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS provider_profiles JSONB NULL
    `);

    await client.query("COMMIT");

    return {
      applied: true,
      appliedAt: new Date(insertRes.rows[0]!.applied_at),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
