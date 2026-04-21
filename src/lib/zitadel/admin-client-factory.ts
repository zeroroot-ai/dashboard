/**
 * Factory that produces the process-wide `ZitadelAdminClient` singleton used
 * by signup-path server code.
 *
 * SECURITY:
 *  - Env vars are read lazily (at first call) so that missing vars fail at
 *    runtime rather than silently at module-load time, and so that tests can
 *    set env before the factory is invoked.
 *  - The PAT value is trimmed of whitespace/newlines before use — the same
 *    normalisation the bootstrap Job applies via `tr -d '\r\n\t '`.
 *  - No env vars are read at module scope.
 */

import 'server-only';

import { HttpZitadelAdminClient } from './admin-client';
import type { ZitadelAdminClient } from './admin-client';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _instance: ZitadelAdminClient | null = null;

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Returns the lazy-initialised singleton `ZitadelAdminClient` for the
 * signup bot PAT.
 *
 * Throws a descriptive `Error` naming any missing environment variable on
 * the first call. Subsequent calls return the cached instance.
 *
 * Required env vars:
 *  - `ZITADEL_INTERNAL_ISSUER`  — internal base URL, e.g. http://zitadel.gibson.svc:8080
 *  - `ZITADEL_SIGNUP_BOT_PAT`   — the signup-bot PAT (may contain trailing whitespace)
 *  - `ZITADEL_EXTERNAL_DOMAIN`  — external Zitadel domain for Host header forwarding
 */
export function getSignupZitadelAdminClient(): ZitadelAdminClient {
  if (_instance) return _instance;

  const missing: string[] = [];

  const rawApiUrl = process.env.ZITADEL_INTERNAL_ISSUER;
  const rawPat = process.env.ZITADEL_SIGNUP_BOT_PAT;
  const rawExternalDomain = process.env.ZITADEL_EXTERNAL_DOMAIN;

  if (!rawApiUrl) missing.push('ZITADEL_INTERNAL_ISSUER');
  if (!rawPat) missing.push('ZITADEL_SIGNUP_BOT_PAT');
  if (!rawExternalDomain) missing.push('ZITADEL_EXTERNAL_DOMAIN');

  if (missing.length > 0) {
    throw new Error(
      `ZitadelAdminClient: required environment variable(s) are not set: ${missing.join(', ')}. ` +
        `Ensure the gibson-zitadel-signup-bot-pat Secret is mounted on the dashboard Deployment.`,
    );
  }

  // Strip leading/trailing whitespace and line endings from the PAT — the
  // bootstrap Job writes the secret with `tr -d '\r\n\t '` but defensive
  // trimming here handles edge cases in local dev (.env files, copy-paste).
  const pat = rawPat!.replace(/[\r\n\t ]/g, '');
  const apiUrl = rawApiUrl!.trim();
  const externalDomain = rawExternalDomain!.trim();

  _instance = new HttpZitadelAdminClient({ apiUrl, pat, externalDomain });
  return _instance;
}
