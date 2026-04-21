/**
 * Auth.js v5 route handler.
 *
 * Exposes the GET and POST handlers that Auth.js needs to handle OIDC
 * callbacks, sign-in initiations, and sign-out flows. The wildcard segment
 * ([...nextauth]) matches:
 *   GET  /api/auth/callback/zitadel  — OIDC code→token exchange callback
 *   GET  /api/auth/signin            — sign-in page redirect
 *   GET  /api/auth/signout           — sign-out page redirect
 *   POST /api/auth/signin/zitadel    — form-based sign-in initiation
 *   POST /api/auth/signout           — sign-out action
 *   GET  /api/auth/session           — session JSON (used by Auth.js internals)
 *   GET  /api/auth/csrf              — CSRF token endpoint
 *
 * This route must remain public (excluded from the middleware matcher) so that
 * Auth.js can complete the OIDC callback without requiring a pre-existing
 * session. The middleware.ts matcher already excludes `api/auth/*`.
 *
 * No custom logic here — all session shaping, claim forwarding, and
 * authorization callbacks live in auth.ts.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
