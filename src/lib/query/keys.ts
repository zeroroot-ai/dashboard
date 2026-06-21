/**
 * Query key factory for type-safe, consistent query keys.
 *
 * All factory functions require a `tenantId` parameter that is placed as the
 * second segment of every key (immediately after the resource name). This
 * ensures React Query cache entries are strictly isolated per tenant so that
 * switching tenants never surfaces stale data from a previous tenant.
 *
 * Usage:
 * - queryKeys.missions.all - All mission queries (prefix for invalidation)
 * - queryKeys.missions.list(tenantId, filters) - Mission list with filters
 * - queryKeys.missions.detail(tenantId, id) - Single mission detail
 */

// Base keys
const statusBase = ['status'] as const;
const missionsBase = ['missions'] as const;
const agentsBase = ['agents'] as const;
const toolsBase = ['tools'] as const;
const pluginsBase = ['plugins'] as const;
const findingsBase = ['findings'] as const;
const eventsBase = ['events'] as const;
const graphBase = ['graph'] as const;
const analyticsBase = ['analytics'] as const;
const userBase = ['user'] as const;
const alertsBase = ['alerts'] as const;

export const queryKeys = {
  // Daemon status
  status: {
    all: statusBase,
    ping: (tenantId: string) => [...statusBase, tenantId, 'ping'] as const,
    info: (tenantId: string) => [...statusBase, tenantId, 'info'] as const,
  },

  // Missions
  missions: {
    all: missionsBase,
    lists: (tenantId: string) => [...missionsBase, tenantId, 'list'] as const,
    list: (tenantId: string, filters?: unknown) => [...missionsBase, tenantId, 'list', filters] as const,
    details: (tenantId: string) => [...missionsBase, tenantId, 'detail'] as const,
    detail: (tenantId: string, id: string) => [...missionsBase, tenantId, 'detail', id] as const,
    history: (tenantId: string, name: string, limit?: number) =>
      [...missionsBase, tenantId, 'history', name, limit] as const,
  },

  // Agents
  agents: {
    all: agentsBase,
    lists: (tenantId: string) => [...agentsBase, tenantId, 'list'] as const,
    list: (tenantId: string, kind?: string) => [...agentsBase, tenantId, 'list', kind] as const,
    details: (tenantId: string) => [...agentsBase, tenantId, 'detail'] as const,
    detail: (tenantId: string, id: string) => [...agentsBase, tenantId, 'detail', id] as const,
    status: (tenantId: string, id: string) => [...agentsBase, tenantId, 'status', id] as const,
  },

  // Tools
  tools: {
    all: toolsBase,
    lists: (tenantId: string) => [...toolsBase, tenantId, 'list'] as const,
    list: (tenantId: string) => [...toolsBase, tenantId, 'list'] as const,
    details: (tenantId: string) => [...toolsBase, tenantId, 'detail'] as const,
    detail: (tenantId: string, id: string) => [...toolsBase, tenantId, 'detail', id] as const,
  },

  // Plugins
  plugins: {
    all: pluginsBase,
    lists: (tenantId: string) => [...pluginsBase, tenantId, 'list'] as const,
    list: (tenantId: string) => [...pluginsBase, tenantId, 'list'] as const,
    details: (tenantId: string) => [...pluginsBase, tenantId, 'detail'] as const,
    detail: (tenantId: string, id: string) => [...pluginsBase, tenantId, 'detail', id] as const,
    // Plugin access management keys
    available: (tenantId: string) => [...pluginsBase, tenantId, 'available'] as const,
    tenant: (tenantId: string) => [...pluginsBase, tenantId, 'tenant'] as const,
    config: (tenantId: string, pluginName: string) => [...pluginsBase, tenantId, 'config', pluginName] as const,
    health: (tenantId: string, pluginName: string) => [...pluginsBase, tenantId, 'health', pluginName] as const,
  },

  // Findings
  findings: {
    all: findingsBase,
    lists: (tenantId: string) => [...findingsBase, tenantId, 'list'] as const,
    list: (tenantId: string, filters?: unknown) => [...findingsBase, tenantId, 'list', filters] as const,
    details: (tenantId: string) => [...findingsBase, tenantId, 'detail'] as const,
    detail: (tenantId: string, id: string) => [...findingsBase, tenantId, 'detail', id] as const,
  },

  // Events
  events: {
    all: eventsBase,
    stream: (tenantId: string, missionId?: string) =>
      [...eventsBase, tenantId, 'stream', missionId] as const,
  },

  // Graph
  graph: {
    all: graphBase,
    mission: (tenantId: string, missionId: string) => [...graphBase, tenantId, 'mission', missionId] as const,
    filtered: (tenantId: string, filters?: unknown) => [...graphBase, tenantId, 'filtered', filters] as const,
    stats: (tenantId: string) => [...graphBase, tenantId, 'stats'] as const,
    nodes: (tenantId: string) => [...graphBase, tenantId, 'nodes'] as const,
    edges: (tenantId: string) => [...graphBase, tenantId, 'edges'] as const,
    layout: (tenantId: string, type?: string) => [...graphBase, tenantId, 'layout', type] as const,
  },

  // Analytics
  analytics: {
    all: analyticsBase,
    kpis: (tenantId: string) => [...analyticsBase, tenantId, 'kpis'] as const,
    findings: {
      all: [...analyticsBase, 'findings'] as const,
      timeSeries: (tenantId: string, timeRange?: string) =>
        [...analyticsBase, tenantId, 'findings', 'time-series', timeRange] as const,
      bySeverity: (tenantId: string) => [...analyticsBase, tenantId, 'findings', 'by-severity'] as const,
      byCategory: (tenantId: string) => [...analyticsBase, tenantId, 'findings', 'by-category'] as const,
    },
    missions: {
      all: [...analyticsBase, 'missions'] as const,
      heatmap: (tenantId: string) => [...analyticsBase, tenantId, 'missions', 'heatmap'] as const,
    },
    agents: {
      all: [...analyticsBase, 'agents'] as const,
      performance: (tenantId: string) => [...analyticsBase, tenantId, 'agents', 'performance'] as const,
    },
  },

  // User preferences
  user: {
    all: userBase,
    layout: (tenantId: string) => [...userBase, tenantId, 'layout'] as const,
  },

  // Alerts
  alerts: {
    all: alertsBase,
    lists: (tenantId: string) => [...alertsBase, tenantId, 'list'] as const,
    list: (tenantId: string, filters?: { limit?: number; unreadOnly?: boolean }) =>
      [...alertsBase, tenantId, 'list', filters] as const,
  },

  // Traces
  // Gibson Traces, backed by the brain World LLM-call log (gibson#755):
  // run list, per-run detail, per-call transcript.
  traces: {
    all: ['traces'] as const,
    runs: (tenantId: string) => ['traces', tenantId, 'runs'] as const,
    run: (tenantId: string, runId: string) => ['traces', tenantId, 'run', runId] as const,
    call: (tenantId: string, callId: string) => ['traces', tenantId, 'call', callId] as const,
  },

  // Organization graph, teams + memberships + per-user inverse map.
  // Shared cache so /dashboard/organization/users + the user detail page
  // hit the daemon once between navigations. dashboard#174.
  orgGraph: {
    all: ['org-graph'] as const,
    full: (tenantId: string) => ['org-graph', tenantId, 'full'] as const,
  },
} as const;

// Type helpers for query keys
export type QueryKeys = typeof queryKeys;
