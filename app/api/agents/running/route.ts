/**
 * GET /api/agents/running
 *
 * Read-only list of the active tenant's currently running agent instances,
 * for the live agent console (ADR-0016 S12, dashboard#1134). Backs the
 * console's list/tab view: one entry per running instance, each with the
 * run id the console subscribes by.
 *
 * The tenant scope is NOT a query param. It is derived server-side by the
 * daemon from the authenticated identity (the `userClient` bearer + the
 * `x-gibson-tenant` header injected from the active-tenant cookie). The
 * dashboard never re-filters: a foreign instance never reaches this route.
 *
 * Security model: the call flows dashboard -> Envoy (JWT + SPIFFE mTLS) +
 * ext-authz -> daemon, per dashboard `CLAUDE.md`. No direct daemon channel.
 */

import { logger } from '@/src/lib/logger';
import { getServerSession } from '@/src/lib/auth';
import {
  requireActiveTenant,
  activeTenantApiResponse,
} from '@/src/lib/auth/active-tenant';
import { listRunningAgents } from '@/src/lib/gibson-client/agent-console';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const agents = await listRunningAgents();
    return new Response(JSON.stringify({ data: agents }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.warn({ route: 'agents/running', err }, 'listRunningAgents failed');
    return new Response(
      JSON.stringify({ error: 'Failed to list running agents' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
