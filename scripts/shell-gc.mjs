#!/usr/bin/env node
/**
 * Entry point for the shell-user garbage collection CronJob.
 *
 * Run daily (03:00 UTC by default — see the Helm CronJob template) to delete
 * Better Auth user rows that represent unclaimed tenant-operator shell users
 * older than the retention threshold.
 *
 * NOTE ON LANGUAGE CHOICE
 * ---------------------------------------------------------------------------
 * The canonical implementation lives in `src/lib/jobs/unclaimed-shell-gc.ts`
 * and is covered by unit tests via vitest. The production dashboard image
 * runs Node 20 which has no built-in `.ts` loader, so this file inlines the
 * SQL so the CronJob can execute without a transpilation step. Keep the two
 * in sync — the SQL predicates here must match `unclaimed-shell-gc.ts` line
 * for line, otherwise the unit tests won't cover the live behaviour.
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string for the dashboard DB.
 *
 * Flags:
 *   --dry-run             List candidates without deleting.
 *   --older-than-days=N   Override the 30-day age threshold.
 *
 * Exit codes:
 *   0 — success (including "no candidates").
 *   1 — unhandled error (DB unreachable, invalid flags, etc.).
 */

import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Argv parsing — deliberately hand-rolled so we don't pull in a CLI dep.
// Supports `--dry-run`, `--older-than-days=N`, and `--older-than-days N`.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, olderThanDays: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (a.startsWith("--older-than-days=")) {
      args.olderThanDays = parseInt(a.split("=", 2)[1], 10);
      continue;
    }
    if (a === "--older-than-days") {
      args.olderThanDays = parseInt(argv[++i], 10);
      continue;
    }
  }
  if (!Number.isFinite(args.olderThanDays) || args.olderThanDays < 0) {
    throw new Error(
      `shell-gc: --older-than-days must be a non-negative integer, got ${args.olderThanDays}`,
    );
  }
  return args;
}

// ---------------------------------------------------------------------------
// Core GC (mirror of src/lib/jobs/unclaimed-shell-gc.ts). Every change to the
// SQL here must be made in that file too — the unit test suite exercises it.
// ---------------------------------------------------------------------------

const SELECT_SQL = `
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

async function runUnclaimedShellGC({ pool, dryRun, olderThanDays }) {
  const { rows } = await pool.query(SELECT_SQL, [olderThanDays]);
  const candidates = rows.map((r) => ({
    id: r.id,
    email: r.email,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
  }));
  if (dryRun || candidates.length === 0) {
    return { candidates, deleted: [] };
  }
  const deleted = [];
  for (const c of candidates) {
    try {
      const res = await pool.query(`DELETE FROM "user" WHERE id = $1`, [c.id]);
      if ((res.rowCount ?? 0) > 0) {
        deleted.push(c.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[shell-gc] failed to delete user id=${c.id} email=${c.email}: ${msg}`,
      );
    }
  }
  return { candidates, deleted };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("shell-gc: DATABASE_URL is required");
  }
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await runUnclaimedShellGC({
      pool,
      dryRun: args.dryRun,
      olderThanDays: args.olderThanDays,
    });
    const summary = {
      ts: startedAt,
      job: "shell-gc",
      dryRun: args.dryRun,
      olderThanDays: args.olderThanDays,
      candidateCount: result.candidates.length,
      deletedCount: result.deleted.length,
      candidates: args.dryRun
        ? result.candidates.map((c) => ({
            id: c.id,
            email: c.email,
            createdAt:
              c.createdAt instanceof Date
                ? c.createdAt.toISOString()
                : String(c.createdAt),
          }))
        : undefined,
    };
    console.log(JSON.stringify(summary));
  } finally {
    await pool.end().catch(() => {
      /* best-effort close */
    });
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      job: "shell-gc",
      level: "error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  process.exit(1);
});
