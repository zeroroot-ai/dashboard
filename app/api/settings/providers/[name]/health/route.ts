/**
 * GET /api/settings/providers/[name]/health — retrieve the health status of a provider
 *
 * Delegates to the daemon DaemonAdminService GetProviderHealth RPC.
 * No storage logic lives here — this file is delegation-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonGetProviderHealth } from '@/src/lib/gibson-client';
import { translateError } from '../../_lib/error';

type RouteContext = { params: Promise<{ name: string }> };

// ---------------------------------------------------------------------------
// GET /api/settings/providers/[name]/health
// ---------------------------------------------------------------------------

/**
 * Retrieve the health status of a named LLM provider.
 *
 * Returns a DaemonProviderHealthStatus:
 *   status       "healthy" | "unhealthy" | "unknown"
 *   lastCheckAt  string?  — RFC 3339 timestamp of the last health check
 *   lastError    string?  — error message when status is unhealthy
 *
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
    const health = await daemonGetProviderHealth(name, userId, tenantId);
    return Response.json({ health });
  } catch (err) {
    return translateError(err);
  }
}
