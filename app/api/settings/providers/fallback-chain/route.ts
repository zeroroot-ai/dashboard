/**
 * GET /api/settings/providers/fallback-chain — retrieve the ordered fallback chain
 * PUT /api/settings/providers/fallback-chain — replace the fallback chain
 *
 * Both handlers delegate to the daemon DaemonAdminService RPCs.
 * No storage logic lives here — this file is delegation-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import {
  daemonGetFallbackChain,
  daemonSetFallbackChain,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

// ---------------------------------------------------------------------------
// GET /api/settings/providers/fallback-chain
// ---------------------------------------------------------------------------

/**
 * Retrieve the tenant's ordered provider fallback chain.
 * Returns { chain: string[] } — an ordered list of provider names.
 * Returns an empty array when no fallback chain has been configured.
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  try {
    const chain = await daemonGetFallbackChain(userId, tenantId);
    return Response.json({ chain });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/settings/providers/fallback-chain
// ---------------------------------------------------------------------------

/**
 * Replace the tenant's provider fallback chain.
 * The daemon validates that every name in the chain refers to an existing
 * stored provider.
 *
 * Request body:
 *   chain  string[]  (required) — ordered list of provider names
 *
 * Returns 400 (InvalidArgument) when a name references a non-existent provider.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  let body: { chain: string[] };
  try {
    body = await req.json() as { chain: string[] };
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.chain)) {
    return Response.json(
      { error: { code: 'invalid_argument', message: '"chain" must be an array of provider names' } },
      { status: 400 },
    );
  }

  try {
    await daemonSetFallbackChain(body.chain, userId, tenantId);
    return Response.json({ success: true });
  } catch (err) {
    return translateError(err);
  }
}
