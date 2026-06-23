/**
 * Unit tests for GET /api/signup/status (dashboard#855).
 *
 * The route projects the daemon's operator-reported provisioning snapshot
 * (getTenantProvisioningStatus) into the legacy { status, currentStep, steps }
 * shape the provisioning page polls. `found: false` ⇒ still initializing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getStatusImpl = vi.fn();
vi.mock('@/src/lib/gibson-client/provisioning', () => ({
  getTenantProvisioningStatus: (slug: string) => getStatusImpl(slug),
}));

vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  createRateLimitResponse: vi.fn(),
}));

import { GET } from '../route';

beforeEach(() => {
  getStatusImpl.mockReset();
});

function buildReq(tenant: string | null): NextRequest {
  const url = new URL('http://test/api/signup/status');
  if (tenant !== null) url.searchParams.set('tenant', tenant);
  return new NextRequest(url);
}

describe('GET /api/signup/status', () => {
  it('returns 400 when the tenant param is missing', async () => {
    const res = await GET(buildReq(null));
    expect(res.status).toBe(400);
  });

  it('reports provisioning with empty steps when no record exists yet', async () => {
    getStatusImpl.mockResolvedValue({ found: false });
    const res = await GET(buildReq('acme'));
    const body = await res.json();
    expect(body.status).toBe('provisioning');
    expect(body.steps).toEqual([]);
    expect(getStatusImpl).toHaveBeenCalledWith('acme');
  });

  it('maps a Ready / data-plane-ready snapshot to active', async () => {
    getStatusImpl.mockResolvedValue({
      found: true,
      phase: 'Ready',
      dataPlaneReady: true,
      stores: { postgres: 'ready', redis: 'ready', neo4j: 'ready' },
    });
    const res = await GET(buildReq('acme'));
    const body = await res.json();
    expect(body.status).toBe('active');
    expect(body.steps.every((s: { status: string }) => s.status === 'completed')).toBe(true);
  });

  it('maps a Failed phase to provisioning_failed', async () => {
    getStatusImpl.mockResolvedValue({
      found: true,
      phase: 'Failed',
      dataPlaneReady: false,
      stores: { postgres: 'failed', redis: '', neo4j: '' },
    });
    const res = await GET(buildReq('acme'));
    const body = await res.json();
    expect(body.status).toBe('provisioning_failed');
  });

  it('surfaces in-flight stores as a running current step', async () => {
    getStatusImpl.mockResolvedValue({
      found: true,
      phase: 'Provisioning',
      dataPlaneReady: false,
      stores: { postgres: 'ready', redis: 'provisioning', neo4j: '' },
    });
    const res = await GET(buildReq('acme'));
    const body = await res.json();
    expect(body.status).toBe('provisioning');
    expect(body.currentStep).toBe('redis');
  });

  it('returns 503 when the daemon read fails', async () => {
    getStatusImpl.mockRejectedValue(new Error('daemon down'));
    const res = await GET(buildReq('acme'));
    expect(res.status).toBe(503);
  });
});
