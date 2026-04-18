/**
 * Shared PostgreSQL connection pool for server-side use.
 *
 * Provides a single Pool instance that all server-side modules can share.
 * `auth-server.ts` creates its own pool because it initialises before this
 * module is loaded; for every other use-site (webhook routes, migrations,
 * background jobs that receive an injected pool) this is the canonical source.
 *
 * The pool is created lazily on first call so modules that import this file
 * but never call getPool() don't open DB connections (e.g. during build).
 */

import 'server-only';

import { Pool } from 'pg';

let _pool: Pool | null = null;

/**
 * Return the singleton PostgreSQL pool.
 *
 * Throws if DATABASE_URL is unset — callers should only be reached in
 * contexts where the DB is available (i.e. server-side request handlers,
 * not build-time code).
 */
export function getPool(): Pool {
  if (_pool) return _pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[db] DATABASE_URL is not set. ' +
        'Ensure it is configured in the Helm chart or environment.',
    );
  }

  _pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  return _pool;
}

/** Test-only: reset cached pool so env changes take effect between tests. */
export function __resetPoolForTests(): void {
  _pool = null;
}
