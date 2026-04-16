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

  http.post('/api/missions/:id/stop', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'stopped',
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

  // Findings endpoints
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
      findings: findings.slice(0, limit),
      total: findings.length,
      counts: {
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
        info: findings.filter(f => f.severity === 'info').length,
      },
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
  http.get('/api/graph', ({ request }) => {
    const url = new URL(request.url);
    const missionId = url.searchParams.get('missionId');

    return HttpResponse.json({
      nodes: [
        { id: 'mission-1', type: 'mission', label: 'Mission 1', data: {} },
        { id: 'agent-1', type: 'agent', label: 'Agent 1', data: {} },
        { id: 'host-1', type: 'host', label: 'example.com', data: {} },
        { id: 'finding-1', type: 'finding', label: 'SQL Injection', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'mission-1', target: 'agent-1', type: 'uses' },
        { id: 'e2', source: 'agent-1', target: 'host-1', type: 'scans' },
        { id: 'e3', source: 'agent-1', target: 'finding-1', type: 'discovered' },
      ],
      stats: {
        nodes: 4,
        edges: 3,
        byType: {
          mission: 1,
          agent: 1,
          host: 1,
          finding: 1,
        },
      },
    });
  }),
];
