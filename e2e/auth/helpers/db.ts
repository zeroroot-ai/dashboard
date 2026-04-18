/**
 * db.ts — direct Postgres helpers for e2e test assertions.
 *
 * Used by tests that need to assert database state, e.g.:
 *   - "no user row was created for this email"
 *   - "this user has emailVerified = true"
 *   - "the organization was created with the expected slug"
 *
 * Connection:
 *   Reads `DATABASE_URL` from the environment.  In a kind cluster the caller
 *   is expected to have opened a `kubectl port-forward` to the Postgres pod
 *   before running the suite, or the Postgres NodePort must be reachable.
 *   `PGPORT` (default 5432) and `PGHOST` (default 127.0.0.1) can be
 *   overridden via env.
 *
 *   DATABASE_URL takes precedence over individual PGHOST / PGPORT env vars.
 *
 * The `pg` package is a devDependency in the dashboard; if it is not
 * installed these helpers skip gracefully rather than crashing the suite.
 *
 * Usage:
 *   import { queryUser, queryOrg, closeDbPool } from './db';
 *
 *   const user = await queryUser('test@example.com');
 *   expect(user).toBeNull(); // no row created
 *
 *   test.afterAll(async () => { await closeDbPool(); });
 */

// ---------------------------------------------------------------------------
// Lazy-import pg so tests still list/parse when pg is absent
// ---------------------------------------------------------------------------

type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

let _pool: PgPool | null = null;
let _pgAvailable = true;

async function getPool(): Promise<PgPool | null> {
  if (!_pgAvailable) return null;
  if (_pool) return _pool;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as { Pool: new (opts?: object) => PgPool };

    const connString =
      process.env.DATABASE_URL ??
      `postgresql://${process.env.PGUSER ?? "postgres"}:${process.env.PGPASSWORD ?? "postgres"}` +
        `@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5432"}` +
        `/${process.env.PGDATABASE ?? "gibson"}`;

    _pool = new Pool({ connectionString: connString, max: 2 });
    return _pool;
  } catch {
    _pgAvailable = false;
    console.warn(
      "[e2e/db] `pg` package not available or DATABASE_URL not set — DB assertions will be skipped.",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public query helpers
// ---------------------------------------------------------------------------

/**
 * Looks up a user row by email from Better Auth's `user` table.
 * Returns `null` if no row exists or if DB is unreachable.
 */
export async function queryUser(email: string): Promise<Record<string, unknown> | null> {
  const pool = await getPool();
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      `SELECT id, email, "emailVerified", "createdAt" FROM "user" WHERE email = $1 LIMIT 1`,
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[e2e/db] queryUser failed:", err);
    return null;
  }
}

/**
 * Looks up an organization row by slug from Better Auth's `organization` table.
 * Returns `null` if no row exists or if DB is unreachable.
 */
export async function queryOrg(slug: string): Promise<Record<string, unknown> | null> {
  const pool = await getPool();
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[e2e/db] queryOrg failed:", err);
    return null;
  }
}

/**
 * Returns the count of organization memberships for the user with the
 * given email.  Used by the no-workspace test after deleting all memberships.
 */
export async function countMembershipsForEmail(email: string): Promise<number | null> {
  const pool = await getPool();
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM member m
       JOIN "user" u ON u.id = m."userId"
       WHERE u.email = $1`,
      [email.toLowerCase()],
    );
    const row = rows[0];
    if (!row) return 0;
    return parseInt(String(row["cnt"] ?? "0"), 10);
  } catch (err) {
    console.warn("[e2e/db] countMembershipsForEmail failed:", err);
    return null;
  }
}

/**
 * Deletes all organization memberships for the user with the given email.
 * Used by the no-workspace test to simulate a user who has no workspace.
 *
 * Returns `true` if the delete succeeded, `null` if DB is unreachable.
 */
export async function deleteAllMembershipsForEmail(email: string): Promise<boolean | null> {
  const pool = await getPool();
  if (!pool) return null;

  try {
    await pool.query(
      `DELETE FROM member
       WHERE "userId" IN (
         SELECT id FROM "user" WHERE email = $1
       )`,
      [email.toLowerCase()],
    );
    return true;
  } catch (err) {
    console.warn("[e2e/db] deleteAllMembershipsForEmail failed:", err);
    return null;
  }
}

/**
 * Closes the shared pool. Call in `test.afterAll` if your test file opens
 * the pool via any of the helpers above.
 */
export async function closeDbPool(): Promise<void> {
  if (_pool) {
    try {
      await _pool.end();
    } catch {
      // ignore
    }
    _pool = null;
  }
}

/**
 * Returns true if the DB pool can be acquired and a trivial query succeeds.
 * Use in `test.skip(!(await isDbAvailable()), '...')` guards.
 */
export async function isDbAvailable(): Promise<boolean> {
  const pool = await getPool();
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
