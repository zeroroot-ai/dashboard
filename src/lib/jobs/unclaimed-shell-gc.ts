/**
 * Shell-user garbage collection.
 *
 * The operator's provisioning saga creates "shell" user rows when a tenant
 * is provisioned for an email address that has never signed up. That user
 * has no credential account and no membership outside the organization
 * they were seeded into. If they never claim the invitation, the row sits
 * around indefinitely and clutters the email namespace.
 *
 * This job identifies those rows and deletes them. Safety constraints:
 *
 *   1. The user must have NO credential account with a non-empty password
 *      (i.e. they never claimed the invitation or completed signup).
 *   2. The user must have ZERO org memberships. This is defense-in-depth:
 *      the provisioning saga adds the user to exactly one org as owner, so
 *      a shell user that still "belongs" somewhere got there through an
 *      unexpected path — leave them for a human to investigate.
 *   3. The user must be older than `olderThanDays` (default 30 days). This
 *      tolerates real users who create an account Friday evening and don't
 *      click the verification link until Monday morning.
 *
 * The job runs via `scripts/shell-gc.mjs` on a daily CronJob. Dry-run mode
 * is wired through `--dry-run` and reports candidates without deleting.
 */

import type { Pool } from "pg";

/**
 * Single candidate row surfaced to the caller. `id` is enough to delete
 * (the deletion path uses it directly). `email` and `createdAt` are echoed
 * so ops can read the dry-run output without a second DB query.
 */
export interface ShellCandidate {
  id: string;
  email: string;
  createdAt: Date;
}

export interface GCOptions {
  /** PG connection pool (standard `pg.Pool`). */
  pool: Pool;
  /**
   * When true, only list candidates — do not delete. Use before the first
   * real run to verify the query is selecting the intended rows.
   */
  dryRun: boolean;
  /**
   * Minimum account age in days before a shell row becomes eligible. Default
   * 30 (per spec 6.7). Passed through to the SQL `INTERVAL` clause.
   */
  olderThanDays?: number;
}

export interface GCResult {
  /** Every row that matched the shell-user filter this run. */
  candidates: ShellCandidate[];
  /** Subset of `candidates` that was actually deleted. Empty on dry-run. */
  deleted: string[];
}

/**
 * Run a single GC pass. Returns both the candidate list and the deletion
 * list so callers can log both (even in dry-run, which logs candidates
 * without mutating the DB).
 *
 * The SQL is intentionally written against the Better Auth schema directly
 * — going through the internalAdapter would require a running `auth` instance
 * (with HTTP plumbing) and would also defeat the batching we get from a
 * single SELECT. The schema is stable: Better Auth v1.6.x guarantees the
 * `user`, `account`, and `member` tables with the column set below.
 */
export async function runUnclaimedShellGC(
  opts: GCOptions,
): Promise<GCResult> {
  const olderThan = opts.olderThanDays ?? 30;
  if (!Number.isFinite(olderThan) || olderThan < 0) {
    throw new Error(
      `runUnclaimedShellGC: olderThanDays must be a non-negative number, got ${olderThan}`,
    );
  }

  // Select shell candidates. A "shell" user:
  //   * has no `account` row with providerId='credential' carrying a
  //     non-empty password hash, AND
  //   * has no `member` rows (defense-in-depth — true shells usually have
  //     exactly one membership for the org they were seeded into, but we
  //     rely on the operator's orphan-user cleanup having removed that row
  //     when the tenant was deleted, or on no tenant existing).
  // The `createdAt < now() - interval 'N days'` clause is the age threshold.
  const selectSQL = `
    SELECT u.id, u.email, u."createdAt"
    FROM "user" u
    WHERE u."createdAt" < NOW() - ($1::int * INTERVAL '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM "account" a
        WHERE a."userId" = u.id
          AND a."providerId" = 'credential'
          AND a.password IS NOT NULL
          AND a.password <> ''
      )
      AND NOT EXISTS (
        SELECT 1 FROM "member" m
        WHERE m."userId" = u.id
      )
    ORDER BY u."createdAt" ASC
  `;

  const { rows } = await opts.pool.query<{
    id: string;
    email: string;
    createdAt: Date;
  }>(selectSQL, [olderThan]);

  const candidates: ShellCandidate[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  }));

  if (opts.dryRun || candidates.length === 0) {
    return { candidates, deleted: [] };
  }

  // Delete one row at a time so a partial failure leaves the rest for the
  // next run. The FK cascade on `session` and `account` removes any empty
  // rows attached to the user; `member` is already zero by the SELECT's
  // filter.
  const deleted: string[] = [];
  for (const c of candidates) {
    try {
      const res = await opts.pool.query(
        `DELETE FROM "user" WHERE id = $1`,
        [c.id],
      );
      if ((res.rowCount ?? 0) > 0) {
        deleted.push(c.id);
      }
    } catch (err) {
      // Log + continue. A single row's FK violation should not stop the
      // whole run — the next day's run will retry, and operators can
      // investigate via the log line.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[shell-gc] failed to delete user id=${c.id} email=${c.email}: ${msg}`,
      );
    }
  }

  return { candidates, deleted };
}
