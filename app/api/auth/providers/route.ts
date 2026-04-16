import { NextResponse } from 'next/server';

/**
 * GET /api/auth/providers
 *
 * Returns which OAuth identity providers are configured for the platform.
 * Better Auth handles OAuth providers natively via its social login plugins.
 * This endpoint checks whether Google/GitHub OAuth env vars are configured.
 * Result is cached for 60 seconds to avoid repeated env lookups on every render.
 *
 * Response: { google: boolean, github: boolean }
 */

let cachedProviders: { google: boolean; github: boolean } | null = null;
let cacheExpiry = 0;

export async function GET() {
  const now = Date.now();
  if (cachedProviders && now < cacheExpiry) {
    return NextResponse.json(cachedProviders);
  }

  const google = Boolean(process.env.BETTER_AUTH_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);
  const github = Boolean(process.env.BETTER_AUTH_GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID);

  cachedProviders = { google, github };
  cacheExpiry = now + 60_000;

  return NextResponse.json(cachedProviders);
}
