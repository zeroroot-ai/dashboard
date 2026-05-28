import 'server-only';
import { listAgents, listTools, listPlugins } from '@/src/lib/gibson-client';

// ============================================================================
// Types
// ============================================================================

export interface AgentEntry {
  id: string;
  name: string;
  kind: string;
  health: string;
}

export interface ToolEntry {
  name: string;
  version: string;
}

export interface PluginEntry {
  name: string;
  version: string;
  health: string;
}

export interface PlatformContext {
  agents: AgentEntry[];
  tools: ToolEntry[];
  plugins: PluginEntry[];
}

const EMPTY: PlatformContext = { agents: [], tools: [], plugins: [] };

// ============================================================================
// Context retrieval
// ============================================================================

/**
 * Fetch the tenant's deployed agents, tools, and plugins in parallel.
 * Each slot fails independently — a single RPC failure does not suppress the others.
 * Returns empty context when all three fail or all lists are empty.
 */
export async function getPlatformContext(
  userId: string,
  tenantId: string,
): Promise<PlatformContext> {
  const [agentsResult, toolsResult, pluginsResult] = await Promise.allSettled([
    listAgents(undefined, userId, tenantId),
    listTools(userId, tenantId),
    listPlugins(userId, tenantId),
  ]);

  const agents: AgentEntry[] =
    agentsResult.status === 'fulfilled'
      ? (agentsResult.value.agents ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          health: a.health,
        }))
      : [];

  const tools: ToolEntry[] =
    toolsResult.status === 'fulfilled'
      ? (toolsResult.value.tools ?? []).map((t) => ({
          name: t.name,
          version: t.version,
        }))
      : [];

  const plugins: PluginEntry[] =
    pluginsResult.status === 'fulfilled'
      ? (pluginsResult.value.plugins ?? []).map((p) => ({
          name: p.name,
          version: p.version,
          health: p.health,
        }))
      : [];

  return { agents, tools, plugins };
}
