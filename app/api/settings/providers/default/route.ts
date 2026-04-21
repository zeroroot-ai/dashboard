/**
 * GET /api/settings/providers/default — retrieve the tenant's default provider
 * PUT /api/settings/providers/default — designate a provider as the default
 *
 * Both handlers delegate to the daemon DaemonAdminService RPCs.
 * No storage logic lives here — this file is delegation-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import {
  daemonGetDefaultProvider,
  daemonSetDefaultProvider,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

// ---------------------------------------------------------------------------
// GET /api/settings/providers/default
// ---------------------------------------------------------------------------

/**
 * Retrieve the tenant's current default LLM provider.
 * Returns { provider: DaemonProviderRecord } when a default is set,
 * or { provider: null } when none has been designated.
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
    const provider = await daemonGetDefaultProvider(userId, tenantId);
    return Response.json({ provider });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/settings/providers/default
// ---------------------------------------------------------------------------

/**
 * Designate a provider as the tenant's default.
 * All other providers are atomically demoted on the daemon side.
 *
 * Request body:
 *   name  string  (required) — the provider name to promote as default
 *
 * Returns 404 when no provider with the given name exists for the tenant.
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

  let body: { name: string };
  try {
    body = await req.json() as { name: string };
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  if (!body.name || typeof body.name !== 'string') {
    return Response.json(
      { error: { code: 'invalid_argument', message: '"name" is required' } },
      { status: 400 },
    );
  }

  try {
    await daemonSetDefaultProvider(body.name, userId, tenantId);
    return Response.json({ success: true });
  } catch (err) {
    return translateError(err);
  }
}
