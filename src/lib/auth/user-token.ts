/**
 * Zitadel access-token resolver for user-acting daemon RPCs.
 *
 * The dashboard's user-acting transport (`gibson-client.ts`) forwards the
 * Zitadel access token from the Auth.js session as `Authorization: Bearer`
 * to Envoy, where the `zitadel` `jwt_authn` provider validates it and
 * ext-authz reads the user's `sub` from the decoded payload. This module
 * is the single point that:
 *
 *   - resolves `session.accessToken` from the current request's Auth.js
 *     session via `auth()`, AND
 *   - fails closed with `ConnectError(Unauthenticated)` when no session
 *     exists or the token is empty.
 *
 * Mirrors the workload-side helper `src/lib/spiffe/jwt-svid.ts` for the
 * admin transport. The two helpers are deliberately separate — user-token
 * code never touches the SPIRE Workload API; SPIFFE-token code never
 * touches `auth()`.
 *
 * Per-request memoization via `react.cache()` keeps a single render that
 * issues multiple RPCs from making multiple `auth()` calls.
 *
 * Spec: dashboard-fga-user-identity (R1, R1.5).
 *
 * @module auth/user-token
 */

import 'server-only';

import { cache } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';

import { auth } from '@/auth';
import { logger } from '@/src/lib/logger';

/**
 * Returns the Zitadel access token for the current request.
 *
 * Per-request memoized via `react.cache()` so multiple Server Components
 * within one render share a single `auth()` call.
 *
 * @throws {ConnectError} with code {@link Code.Unauthenticated} when no
 *   session exists or `session.accessToken` is empty. Caller should let
 *   this propagate so middleware / route handlers can route to /login.
 */
export const requireUserToken = cache(async (): Promise<string> => {
  const session = await auth();
  if (!session?.accessToken) {
    throw new ConnectError(
      'No Zitadel access token in session — user must be signed in via Zitadel OIDC',
      Code.Unauthenticated,
    );
  }
  // Defensive shape check: a valid Zitadel access token is a JWT (three
  // dot-delimited base64url segments). Middleware (middleware.ts step 1b)
  // redirects opaque-token sessions to sign-in before they reach a Server
  // Component or Server Action, so this branch should never fire in
  // normal operation. Log at debug level only — a warn here would be a
  // false alarm for any path that legitimately bypasses middleware (e.g.
  // route handlers excluded from the matcher).
  if (session.accessToken.split('.').length !== 3) {
    logger.warn(
      { tokenLength: session.accessToken.length },
      '[session-debug] access token is not JWT-shaped; middleware should have redirected — check matcher config',
    );
  }
  return session.accessToken;
});
