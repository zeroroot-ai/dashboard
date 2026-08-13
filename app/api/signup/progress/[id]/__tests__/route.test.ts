/**
 * Unit tests for GET /api/signup/progress/:id (dashboard#967).
 *
 * The route serves the stored progress record verbatim, EXCEPT when the
 * record is a dead end — terminal `timeout`, or expired out of the store —
 * and the caller supplies the tenant slug: then it probes the live
 * operator-reported provisioning status and synthesizes the `ok` record
 * the (already-returned) Server Action could never write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getProgressImpl = vi.fn();
vi.mock('@/src/lib/signup/progress-store', () => ({
  getProgress: (id: string) => getProgressImpl(id),
}));

const getStatusImpl = vi.fn();
vi.mock('@/src/lib/gibson-client/provisioning', () => ({
  getTenantProvisioningStatus: (slug: string) => getStatusImpl(slug),
}));

const checkRateLimitImpl = vi.fn();
vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitImpl(...args),
}));

import { GET } from '../route';

const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';

const TIMEOUT_RECORD = {
  step: 'setup_workspace',
  stepStartedAt: 1700000000000,
  terminalState: 'timeout',
  error: {
    code: 'PROVISIONING_TIMEOUT',
    userMessage: "Still setting up your workspace, we'll email you when it's ready.",
  },
};

const READY_STATUS = {
  found: true,
  phase: 'Ready',
  dataPlaneReady: true,
  zitadelOrgReady: true,
  stores: { postgres: 'ready', redis: 'ready', neo4j: 'ready' },
};

const NOT_READY_STATUS = {
  found: true,
  phase: 'Provisioning',
  dataPlaneReady: false,
  zitadelOrgReady: false,
  stores: { postgres: 'ready', redis: 'provisioning', neo4j: '' },
};

beforeEach(() => {
  getProgressImpl.mockReset();
  getStatusImpl.mockReset();
  checkRateLimitImpl.mockReset();
  checkRateLimitImpl.mockResolvedValue({ allowed: true });
});

function call(id: string, slug?: string) {
  const url = new URL(`http://test/api/signup/progress/${id}`);
  if (slug !== undefined) url.searchParams.set('slug', slug);
  return GET(new NextRequest(url), { params: Promise.resolve({ id }) });
}

describe('GET /api/signup/progress/:id', () => {
  it('rejects a malformed id without touching the store', async () => {
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    expect(getProgressImpl).not.toHaveBeenCalled();
  });

  it('serves a non-terminal record verbatim and never probes readiness', async () => {
    const record = { step: 'setup_workspace', stepStartedAt: 1 };
    getProgressImpl.mockResolvedValue(record);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(record);
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it('404s on an absent record with no slug', async () => {
    getProgressImpl.mockResolvedValue(null);
    const res = await call(ATTEMPT_ID);
    expect(res.status).toBe(404);
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it('flips a stored timeout to ok when the tenant is live-Ready', async () => {
    getProgressImpl.mockResolvedValue(TIMEOUT_RECORD);
    getStatusImpl.mockResolvedValue(READY_STATUS);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminalState).toBe('ok');
    expect(body.step).toBe('done');
    expect(getStatusImpl).toHaveBeenCalledWith('acme');
  });

  it('keeps serving the stored timeout while the tenant is not ready', async () => {
    getProgressImpl.mockResolvedValue(TIMEOUT_RECORD);
    getStatusImpl.mockResolvedValue(NOT_READY_STATUS);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect((await res.json()).terminalState).toBe('timeout');
  });

  it('resolves an EXPIRED record to ok when the tenant is live-Ready', async () => {
    getProgressImpl.mockResolvedValue(null);
    getStatusImpl.mockResolvedValue(READY_STATUS);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect((await res.json()).terminalState).toBe('ok');
  });

  it('404s an expired record when the tenant is not ready', async () => {
    getProgressImpl.mockResolvedValue(null);
    getStatusImpl.mockResolvedValue(NOT_READY_STATUS);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(404);
  });

  it('never probes with a slug that slugify() could not have produced', async () => {
    getProgressImpl.mockResolvedValue(TIMEOUT_RECORD);
    for (const bad of ['Acme', 'a_b', '-acme', 'acme-', 'a'.repeat(64), '']) {
      const res = await call(ATTEMPT_ID, bad);
      expect(res.status).toBe(200);
      expect((await res.json()).terminalState).toBe('timeout');
    }
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it('skips the probe (but still answers from the store) when rate-limited', async () => {
    checkRateLimitImpl.mockResolvedValue({ allowed: false });
    getProgressImpl.mockResolvedValue(TIMEOUT_RECORD);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect((await res.json()).terminalState).toBe('timeout');
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it('falls back to the stored record when the readiness probe throws', async () => {
    getProgressImpl.mockResolvedValue(TIMEOUT_RECORD);
    getStatusImpl.mockRejectedValue(new Error('daemon unavailable'));
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect((await res.json()).terminalState).toBe('timeout');
  });

  it('never flips a genuinely FAILED record, even with a Ready tenant', async () => {
    const failed = { ...TIMEOUT_RECORD, terminalState: 'failed' };
    getProgressImpl.mockResolvedValue(failed);
    getStatusImpl.mockResolvedValue(READY_STATUS);
    const res = await call(ATTEMPT_ID, 'acme');
    expect(res.status).toBe(200);
    expect((await res.json()).terminalState).toBe('failed');
    expect(getStatusImpl).not.toHaveBeenCalled();
  });
});
