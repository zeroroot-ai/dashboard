/**
 * GET    /api/settings/providers/[name] — retrieve a single provider config
 * PATCH  /api/settings/providers/[name] — update an existing provider config
 * PUT    /api/settings/providers/[name] — alias for PATCH (client compat)
 * DELETE /api/settings/providers/[name] — permanently delete a provider config
 *
 * All handlers delegate to the daemon TenantAdminService RPCs.
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
import { toProviderConfig } from '@/src/lib/providers-adapter';

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
    const record = await daemonGetProvider(name, userId, tenantId);
    return Response.json({ provider: toProviderConfig(record) });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH / PUT /api/settings/providers/[name]
// ---------------------------------------------------------------------------

/**
 * Update an existing provider config.
 *
 * Accepts two body shapes for compatibility:
 *   - Direct:  DaemonProviderConfigInput  (used by server actions)
 *   - Wrapped: { config: DaemonProviderConfigInput, testConnection?: boolean }
 *              (used by the providers page client hook)
 *
 * Empty credential values mean "retain stored value" in the daemon.
 * The plaintext credentials transit this handler's memory for one request
 * and are never persisted by the dashboard.
 */
async function handleUpdate(req: NextRequest, { params }: RouteContext): Promise<Response> {
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  // Unwrap { config: {...} } wrapper if present, otherwise treat as direct input.
  const partial = (
    raw !== null &&
    typeof raw === 'object' &&
    'config' in (raw as Record<string, unknown>)
      ? (raw as { config: Partial<DaemonProviderConfigInput> }).config
      : raw
  ) as Partial<DaemonProviderConfigInput>;

  try {
    // If the client only supplied credentials (edit-credentials flow), fetch
    // the existing record so we can merge name/type/defaultModel and send a
    // complete ProviderConfigInput to the daemon.
    let merged: DaemonProviderConfigInput;
    if (!partial.type || !partial.name) {
      const existing = await daemonGetProvider(name, userId, tenantId);
      merged = {
        name: partial.name ?? existing.name,
        type: partial.type ?? existing.type,
        defaultModel: partial.defaultModel ?? existing.defaultModel,
        credentials: { ...partial.credentials },
        setAsDefault: partial.setAsDefault ?? existing.isDefault,
      };
    } else {
      merged = partial as DaemonProviderConfigInput;
    }

    const record = await daemonUpdateProvider(name, merged, userId, tenantId);
    return Response.json({ provider: toProviderConfig(record) });
  } catch (err) {
    return translateError(err);
  }
}

export const PATCH = handleUpdate;
export const PUT = handleUpdate;

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
