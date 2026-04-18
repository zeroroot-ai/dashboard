/**
 * Google OAuth2 callback route.
 *
 * This is the sole exception to the "no public auth HTTP surface" rule —
 * OAuth2 callback URLs must be HTTP endpoints that receive the provider's
 * redirect. This route does no business logic; it delegates exclusively to
 * Better Auth's handler which completes the token exchange, creates/links
 * the user, sets the session cookie, and issues the final redirect.
 *
 * Allowed by: scripts/check-no-public-auth.mjs (explicit allowlist).
 * Whitelisted redirect URI at Google: {BETTER_AUTH_URL}/api/auth/callback/google
 */

import { auth } from "@/src/lib/auth-server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  return auth.handler(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return auth.handler(request);
}
