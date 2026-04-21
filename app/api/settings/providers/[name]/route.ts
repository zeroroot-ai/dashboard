/**
 * GET    /api/settings/providers/[name] — retrieve a single provider config
 * PATCH  /api/settings/providers/[name] — update an existing provider config
 * DELETE /api/settings/providers/[name] — permanently delete a provider config
 *
 * All handlers delegate to the daemon DaemonAdminService RPCs.
 * No storage logic lives here — this file is delegation-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import {
  daemonGetProvider,
  daemonUpdateProvider,
  daemonDeleteProvider,
  type DaemonProviderConfigInput,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

type RouteContext = { params: Promise<{ name: string }> };

// ---------------------------------------------------------------------------
// GET /api/settings/providers/[name]
// ---------------------------------------------------------------------------

/**
 * Retrieve a single provider config by name.
 * Returns masked credential values only.
 * Returns 404 when no provider with the given name exists for the tenant.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const { name } = await params;
  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  try {
    const provider = await daemonGetProvider(name, userId, tenantId);
    return Response.json({ provider });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/settings/providers/[name]
// ---------------------------------------------------------------------------

/**
 * Update an existing provider config.
 *
 * Request body shape matches DaemonProviderConfigInput. The daemon accepts a
 * full record on update; empty credential values mean "retain stored value".
 * Returns the updated provider record with masked credentials.
 *
 * The plaintext credentials transit this handler's memory for one request
 * and are never persisted by the dashboard.
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const { name } = await params;
  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  let body: DaemonProviderConfigInput;
  try {
    body = await req.json() as DaemonProviderConfigInput;
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  try {
    const provider = await daemonUpdateProvider(name, body, userId, tenantId);
    return Response.json({ provider });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/settings/providers/[name]
// ---------------------------------------------------------------------------

/**
 * Permanently delete a provider config by name.
 * Returns 404 when no provider with the given name exists for the tenant.
 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const { name } = await params;
  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  try {
    await daemonDeleteProvider(name, userId, tenantId);
    return Response.json({ success: true });
  } catch (err) {
    return translateError(err);
  }
}
