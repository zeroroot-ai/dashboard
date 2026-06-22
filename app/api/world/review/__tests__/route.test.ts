/**
 * Per-route contract test for /api/world/review (the HITL review/label queue,
 * gibson#753). WorldService is mocked via userClient so this is a pure route
 * contract: GET maps the queue, POST validates + forwards SubmitLabel, plus the
 * 401 and 400 paths. The daemon enforces tenant isolation; this verifies the
 * dashboard never supplies a user id and rejects an unknown verdict.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockListReviewQueue = vi.fn();
const mockSubmitLabel = vi.fn();

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      listReviewQueue: (...args: unknown[]) => mockListReviewQueue(...args),
      submitLabel: (...args: unknown[]) => mockSubmitLabel(...args),
    }),
  };
});

vi.mock('server-only', () => ({}));

import { GET, POST } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://test.local/api/world/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
});

describe('GET /api/world/review', () => {
  it('maps the review queue, including an applied label', async () => {
    mockListReviewQueue.mockResolvedValue({
      items: [
        {
          targetId: 'anomaly-host-1',
          kind: 'finding',
          title: 'Identity anomaly at 10.0.0.5',
          scopeId: 's1',
          address: '10.0.0.5',
          severity: 'medium',
          labelled: true,
          label: {
            targetId: 'anomaly-host-1',
            verdict: 'true_positive',
            severity: 'high',
            category: 'rce',
            userId: 'alice',
          },
        },
        {
          targetId: 'surprise-host-2',
          kind: 'surprise',
          title: 'Surprise at 10.0.0.6',
          scopeId: 's1',
          address: '10.0.0.6',
          severity: 'medium',
          labelled: false,
          label: undefined,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].label.verdict).toBe('true_positive');
    expect(body.items[1].labelled).toBe(false);
    expect(body.items[1].label).toBeNull();
  });

  it('401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/world/review', () => {
  it('forwards a valid label WITHOUT a user id (daemon stamps it)', async () => {
    mockSubmitLabel.mockResolvedValue({});
    const res = await POST(
      postReq({ targetId: 'anomaly-host-1', verdict: 'true_positive', category: 'rce' }),
    );
    expect(res.status).toBe(200);
    expect(mockSubmitLabel).toHaveBeenCalledTimes(1);
    const arg = mockSubmitLabel.mock.calls[0][0];
    expect(arg.targetId).toBe('anomaly-host-1');
    expect(arg.verdict).toBe('true_positive');
    // The dashboard must never supply a user id — no cross-user attribution.
    expect(arg).not.toHaveProperty('userId');
  });

  it('400 on an unknown verdict (fail-closed)', async () => {
    const res = await POST(postReq({ targetId: 'x', verdict: 'bogus' }));
    expect(res.status).toBe(400);
    expect(mockSubmitLabel).not.toHaveBeenCalled();
  });

  it('400 on a missing target', async () => {
    const res = await POST(postReq({ verdict: 'dismiss' }));
    expect(res.status).toBe(400);
    expect(mockSubmitLabel).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(postReq({ targetId: 'x', verdict: 'dismiss' }));
    expect(res.status).toBe(401);
  });
});
