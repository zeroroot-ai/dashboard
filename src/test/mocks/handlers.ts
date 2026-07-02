import { http, HttpResponse } from 'msw';

/**
 * MSW handlers for API mocking in tests
 * These handlers mock the API routes used by the dashboard
 */

// Mock data generators
const generateMission = (id: string) => ({
  id,
  name: `Mission ${id}`,
  status: ['pending', 'running', 'completed', 'failed'][Math.floor(Math.random() * 4)],
  progress: Math.floor(Math.random() * 100),
  startedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
  agents: Math.floor(Math.random() * 5) + 1,
  findings: Math.floor(Math.random() * 20),
  config: {
    target: 'example.com',
    depth: 3,
    timeout: 300,
  },
});

const generateFinding = (id: string) => ({
  id,
  title: `Finding ${id}`,
  severity: ['critical', 'high', 'medium', 'low', 'info'][Math.floor(Math.random() * 5)],
  type: ['vulnerability', 'misconfiguration', 'exposure', 'weakness'][Math.floor(Math.random() * 4)],
  description: 'A detailed description of the finding',
  discoveredAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
  missionId: 'mission-1',
  assets: Math.floor(Math.random() * 5) + 1,
  evidence: {
    url: 'https://example.com/vulnerable',
    method: 'GET',
    response: 'Sample response data',
  },
  remediation: 'Steps to remediate this finding',
});

const generateEvent = (id: number) => ({
  id,
  type: ['mission.started', 'mission.completed', 'finding.created', 'agent.status'][Math.floor(Math.random() * 4)],
  source: `agent-${Math.floor(Math.random() * 5) + 1}`,
  message: `Event message ${id}`,
  timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
  payload: {
    detail: 'Additional event data',
  },
});

const generateComponent = (id: string, type: 'agent' | 'tool' | 'plugin') => ({
  id,
  name: `${type}-${id}`,
  type,
  status: ['healthy', 'degraded', 'unhealthy'][Math.floor(Math.random() * 3)],
  lastActivity: new Date(Date.now() - Math.random() * 3600000).toISOString(),
  replicas: type === 'agent' ? Math.floor(Math.random() * 3) + 1 : 1,
  resourceUtilization: {
    cpu: Math.random() * 100,
    memory: Math.random() * 100,
  },
  errorRate: Math.random() * 5,
});

export const handlers = [
  // Core application handlers
  // Status endpoint
  http.get('/api/status', () => {
    return HttpResponse.json({
      status: 'healthy',
      version: '1.0.0',
      uptime: 86400,
      components: {
        daemon: 'healthy',
        database: 'healthy',
        queue: 'healthy',
      },
    });
  }),

  // Missions endpoints
  http.get('/api/missions', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const limit = parseInt(url.searchParams.get('limit') || '10');

    let missions = Array.from({ length: 20 }, (_, i) => generateMission(`mission-${i + 1}`));

    if (status) {
      missions = missions.filter(m => m.status === status);
    }

    return HttpResponse.json({
      missions: missions.slice(0, limit),
      total: missions.length,
      page: 1,
      pageSize: limit,
    });
  }),

  http.get('/api/missions/:id', ({ params }) => {
    const { id } = params;
    return HttpResponse.json(generateMission(id as string));
  }),

  http.post('/api/missions/run', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      id: `mission-${Date.now()}`,
      status: 'pending',
      ...body,
    }, { status: 201 });
  }),

  // Supported-provider catalogue consumed by useSupportedProviders. Hook
  // expects `{ providers: SupportedProviderDescriptor[] }`. An empty list
  // is a valid successful response, the test asserts data === [].
  http.get('/api/settings/providers/supported', () => {
    return HttpResponse.json({ providers: [] });
  }),

  // Mission lifecycle transitions consumed by useStartMission / usePauseMission
  // / useResumeMission / useStopMission. Each handler returns the post-
  // transition state so the optimistic update + final-state assertions agree.
  http.post('/api/missions/:id/start', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  }),

  http.post('/api/missions/:id/stop', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'stopped',
      completedAt: new Date().toISOString(),
    });
  }),

  http.post('/api/missions/:id/pause', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'paused',
    });
  }),

  http.post('/api/missions/:id/resume', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'running',
    });
  }),

  // Findings endpoints. Response shape must match PaginatedResponse<Finding>:
  // `{ data: Finding[], total: number, nextCursor?: string }`, see
  // src/types/index.ts. Earlier the handler returned `{ findings, ... }`
  // which made every test that read `result.current.data?.data` fail with
  // "expected undefined to be defined".
  http.get('/api/findings', ({ request }) => {
    const url = new URL(request.url);
    const severity = url.searchParams.get('severity');
    const search = url.searchParams.get('search');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    let findings = Array.from({ length: 50 }, (_, i) => generateFinding(`finding-${i + 1}`));

    if (severity) {
      findings = findings.filter(f => f.severity === severity);
    }

    if (search) {
      findings = findings.filter(f =>
        f.title.toLowerCase().includes(search.toLowerCase()) ||
        f.description.toLowerCase().includes(search.toLowerCase())
      );
    }

    return HttpResponse.json({
      data: findings.slice(0, limit),
      total: findings.length,
    });
  }),

  // Severity-counts endpoint consumed by useFindingsCounts. Hook expects
  // a bare FindingsCountsBySeverity record, no envelope.
  http.get('/api/findings/counts', () => {
    const findings = Array.from({ length: 50 }, (_, i) => generateFinding(`finding-${i + 1}`));
    return HttpResponse.json({
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    });
  }),

  http.get('/api/findings/:id', ({ params }) => {
    return HttpResponse.json(generateFinding(params.id as string));
  }),

  // Events endpoints
  http.get('/api/events', ({ request }) => {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const type = url.searchParams.get('type');

    let events = Array.from({ length: 100 }, (_, i) => generateEvent(i + 1));

    if (type) {
      events = events.filter(e => e.type === type);
    }

    return HttpResponse.json({
      events: events.slice(0, limit),
      total: events.length,
    });
  }),

  // Components endpoints
  http.get('/api/components/agents', () => {
    return HttpResponse.json({
      agents: Array.from({ length: 5 }, (_, i) => generateComponent(`${i + 1}`, 'agent')),
      total: 5,
    });
  }),

  http.get('/api/components/tools', () => {
    return HttpResponse.json({
      tools: Array.from({ length: 8 }, (_, i) => generateComponent(`${i + 1}`, 'tool')),
      total: 8,
    });
  }),

  http.get('/api/components/plugins', () => {
    return HttpResponse.json({
      plugins: Array.from({ length: 3 }, (_, i) => generateComponent(`${i + 1}`, 'plugin')),
      total: 3,
    });
  }),

  // Graph endpoints
  // Graph nodes/edges. Hook expects `{ nodes: GraphNode[], edges: GraphEdge[] }`
  // where GraphNode has { id, labels[], properties{} } (Neo4j-style), see
  // src/types/graph.ts.
  http.get('/api/graph', () => {
    return HttpResponse.json({
      nodes: [
        { id: 'mission-1', labels: ['Mission'], properties: { name: 'Mission 1' } },
        { id: 'agent-1', labels: ['Agent'], properties: { name: 'Recon Agent' } },
        { id: 'host-1', labels: ['Host'], properties: { name: 'example.com' } },
        { id: 'finding-1', labels: ['Finding'], properties: { title: 'SQL Injection' } },
      ],
      edges: [
        { id: 'e1', source: 'mission-1', target: 'agent-1', type: 'uses', properties: {} },
        { id: 'e2', source: 'agent-1', target: 'host-1', type: 'scans', properties: {} },
        { id: 'e3', source: 'agent-1', target: 'finding-1', type: 'discovered', properties: {} },
      ],
    });
  }),

  // Mission-scoped graph fetched by useMissionGraph.
  http.get('/api/graph/mission/:missionId', ({ params }) => {
    const missionId = params.missionId as string;
    return HttpResponse.json({
      nodes: [
        { id: missionId, labels: ['Mission'], properties: { name: 'Test Mission' } },
        { id: 'agent-1', labels: ['Agent'], properties: { name: 'Recon Agent' } },
      ],
      edges: [
        { id: 'e1', source: missionId, target: 'agent-1', type: 'uses', properties: {} },
      ],
    });
  }),

  // Aggregate stats fetched by useGraphStats. Hook expects GraphStats shape
  // { totalNodes, totalEdges, nodesByType, relationshipTypes } from useGraph.ts.
  http.get('/api/graph/stats', () => {
    return HttpResponse.json({
      totalNodes: 4,
      totalEdges: 3,
      nodesByType: { Mission: 1, Agent: 1, Host: 1, Finding: 1 },
      relationshipTypes: { uses: 1, scans: 1, discovered: 1 },
    });
  }),
];
