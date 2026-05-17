import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';

/**
 * GET /api/components/permissions
 *
 * Return the current tenant's component-level permission map.
 *
 * For v1 the response is intentionally simple:
 *   - **plugins** — per-plugin enabled/read/write flags derived from the
 *     tenant plugin-access system (`listTenantPlugins`).
 *   - **tools** / **agents** — empty objects; the daemon enforces
 *     all-or-nothing access at runtime via API-key capabilities.
 *
 * Read-only endpoint — no admin role required.
 */
// BRIDGE: This route reads access state from tenant config flags.
// When the daemon exposes a dedicated access query RPC, migrate to that.
// For now, fail-open: default to enabled=true for visibility.
// The daemon enforces actual access via Casbin at runtime.
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenantId;

    const permissions = {
      plugins: {} as Record<string, { enabled: boolean; readEnabled: boolean; writeEnabled: boolean }>,
      tools: {} as Record<string, { enabled: boolean }>,
      agents: {} as Record<string, { enabled: boolean }>,
    };

    // Populate plugin permissions — daemon enforces actual access via FGA.
    // Per-tenant plugin enable flags moved to the Tenant CRD; for now we
    // surface every visible plugin as enabled and let the daemon deny at
    // call time.
    if (tenantId) {
      try {
        const { listPlugins } = await import('@/src/lib/gibson-client');
        const { plugins: pluginList } = await listPlugins(session?.user?.id, tenantId);
        for (const plugin of pluginList ?? []) {
          permissions.plugins[plugin.name] = {
            enabled: true,
            readEnabled: true,
            writeEnabled: true,
          };
        }
      } catch (err) {
        console.warn('Failed to fetch plugins for permissions:', err);
      }
    }

    // Populate tool permissions — all visible tools are enabled by default
    try {
      const { listTools } = await import('@/src/lib/gibson-client');
      const { tools: toolList } = await listTools(session?.user?.id);
      for (const tool of toolList ?? []) {
        permissions.tools[tool.name] = { enabled: true };
      }
    } catch (err) {
      console.warn('Failed to fetch tools for permissions:', err);
    }

    // Populate agent permissions — all visible agents are enabled by default
    try {
      const { listAgents } = await import('@/src/lib/gibson-client');
      const { agents: agentList } = await listAgents(undefined, session?.user?.id);
      for (const agent of agentList ?? []) {
        permissions.agents[agent.name] = { enabled: true };
      }
    } catch (err) {
      console.warn('Failed to fetch agents for permissions:', err);
    }

    return NextResponse.json(permissions);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
