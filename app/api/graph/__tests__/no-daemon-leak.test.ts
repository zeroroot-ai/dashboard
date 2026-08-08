/**
 * The graph and findings-count routes must not hand the daemon's own error
 * text to the browser.
 *
 * These routes used to return `{ error: err.message }` on any ConnectError.
 * A daemon message is written for operators: it can name internal hostnames,
 * mounts, gRPC method paths and whatever a wrapped Go error accumulated on the
 * way up. This suite pins the two properties that matter — the daemon's words
 * do NOT appear in the body, and the canonical envelope DOES.
 *
 * Refs GHSA-xxg9-2h3v-588p.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

// A message with the shape of a real leaked one: internal host, gRPC path.
const DAEMON_DETAIL =
  'rpc error: dial tcp gibson-gibson-workloads.gibson.svc.cluster.local:50051: ' +
  'connect: connection refused (/gibson.graph.v1.GraphService/GetTenantGraph)';

const getTenantGraph = vi.fn();
const getGraphStats = vi.fn();
const getMissionGraph = vi.fn();
const getFindingCounts = vi.fn();
const queryPaths = vi.fn();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(async () => 'tenant-1'),
  activeTenantApiResponse: vi.fn(),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => ({
    getTenantGraph,
    getGraphStats,
    getMissionGraph,
    getFindingCounts,
    queryPaths,
  })),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * A stand-in for NextRequest. These routes read only `headers`,
 * `nextUrl.searchParams` and `json()`, all of which a plain Request provides.
 */
function req(url: string, init?: RequestInit) {
  const r = new Request(url, init) as Request & { nextUrl: URL };
  r.nextUrl = new URL(url);
  return r as unknown as import('next/server').NextRequest;
}

/** A route's failure body, whatever its shape, as one searchable string. */
async function bodyText(res: Response): Promise<string> {
  return JSON.stringify(await res.json());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('graph + findings routes do not leak daemon error text', () => {
  const cases: Array<{ name: string; arm: () => void; call: () => Promise<Response> }> = [
    {
      name: 'GET /api/graph',
      arm: () =>
        getTenantGraph.mockRejectedValue(new ConnectError(DAEMON_DETAIL, Code.Unavailable)),
      call: async () => {
        const { GET } = await import('../route');
        return GET(req('http://localhost/api/graph'));
      },
    },
    {
      name: 'GET /api/graph/stats',
      arm: () => getGraphStats.mockRejectedValue(new ConnectError(DAEMON_DETAIL, Code.Internal)),
      call: async () => {
        const { GET } = await import('../stats/route');
        return GET(req('http://localhost/api/graph/stats'));
      },
    },
    {
      name: 'GET /api/graph/mission/[id]',
      arm: () => getMissionGraph.mockRejectedValue(new ConnectError(DAEMON_DETAIL, Code.NotFound)),
      call: async () => {
        const { GET } = await import('../mission/[id]/route');
        return GET(req('http://localhost/api/graph/mission/m1'), {
          params: Promise.resolve({ id: 'm1' }),
        });
      },
    },
    {
      name: 'GET /api/findings/counts',
      arm: () =>
        getFindingCounts.mockRejectedValue(
          new ConnectError(DAEMON_DETAIL, Code.PermissionDenied),
        ),
      call: async () => {
        const { GET } = await import('../../findings/counts/route');
        return GET(req('http://localhost/api/findings/counts'));
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name} returns the canonical envelope, not the daemon message`, async () => {
      c.arm();
      const res = await c.call();
      const text = await bodyText(res);

      // The leak itself.
      expect(text).not.toContain('cluster.local');
      expect(text).not.toContain('GraphService');
      expect(text).not.toContain(DAEMON_DETAIL);

      // The replacement: class + correlation id, both machine-readable.
      const parsed = JSON.parse(text) as {
        error: { class: string; message: string; correlationId: string };
      };
      expect(parsed.error.class).toBeTruthy();
      expect(parsed.error.correlationId).toMatch(/^req-/);
      expect(parsed.error.message.length).toBeGreaterThan(0);
      expect(res.headers.get('x-correlation-id')).toBe(parsed.error.correlationId);
    });
  }
});

describe('POST /api/graph/paths', () => {
  const postInit: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from_node_id: 'n1', to_node_kind: 'Finding' }),
  };

  it('does not leak the daemon message on an ordinary failure', async () => {
    queryPaths.mockRejectedValue(new ConnectError(DAEMON_DETAIL, Code.Unavailable));
    const { POST } = await import('../paths/route');
    const res = await POST(req('http://localhost/api/graph/paths', postInit));
    const parsed = (await res.json()) as { error: { class: string; reason?: string } };

    expect(JSON.stringify(parsed)).not.toContain('cluster.local');
    expect(JSON.stringify(parsed)).not.toContain(DAEMON_DETAIL);
    expect(parsed.error.class).toBe('unavailable');
    expect(parsed.error.reason).toBeUndefined();
  });

  it('still identifies the embedding-provider gate, via a sub-code not a message', async () => {
    queryPaths.mockRejectedValue(
      new ConnectError(
        'no embedding provider configured for this tenant, add one in Settings',
        Code.FailedPrecondition,
      ),
    );
    const { POST } = await import('../paths/route');
    const res = await POST(req('http://localhost/api/graph/paths', postInit));
    const parsed = (await res.json()) as { error: { reason?: string; message: string } };

    expect(parsed.error.reason).toBe('no_embedding_provider');
    // The client detects the gate WITHOUT the daemon's wording crossing over.
    expect(parsed.error.message).not.toContain('no embedding provider configured');

    const { isEmbeddingGateError } = await import('@/src/lib/embedding-gate');
    expect(isEmbeddingGateError(parsed)).toBe(true);
  });
});
