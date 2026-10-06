// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for the SignupService client wrappers.
 *
 * Owner provisioning runs daemon-side via the unauthenticated
 * gibson.tenant.v1.SignupService RPCs. This module dials them through the SAME
 * service-acting transport (`serviceClient(Service, '')`, empty tenant) the
 * unauthenticated SetSignupProgress RPC uses — NOT the tenant-scoped
 * userClient.
 *
 * The property worth pinning hardest is what the COMPLETION call does not
 * carry. It sends the session and the password, and nothing that describes
 * which signup is being completed: no address, no company name, no plan. All
 * of those are read daemon-side from the verification row the
 * session resolves to, which is what stops a caller from proving control of one
 * address and provisioning a workspace for another.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSignup,
  mockRequest,
  mockRedeem,
  mockGetStep,
  mockServiceClient,
} = vi.hoisted(() => {
  const mockSignup = vi.fn();
  const mockRequest = vi.fn();
  const mockRedeem = vi.fn();
  const mockGetStep = vi.fn();
  const mockServiceClient = vi.fn(() => ({
    signup: mockSignup,
    requestEmailVerification: mockRequest,
    redeemEmailVerification: mockRedeem,
    getSignupStep: mockGetStep,
  }));
  return { mockSignup, mockRequest, mockRedeem, mockGetStep, mockServiceClient };
});

vi.mock('@/src/lib/gibson-client', () => ({
  serviceClient: mockServiceClient,
}));

import {
  requestSignupVerification,
  redeemSignupVerification,
  completeSignupOwner,
  getSignupStep,
} from '../owner-provisioning';
import { SignupService, SignupStepState } from '@/src/gen/gibson/tenant/v1/signup_pb';

describe('signup service wrappers', () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockRequest.mockReset();
    mockRedeem.mockReset();
    mockGetStep.mockReset();
    mockServiceClient.mockClear();
  });

  it('dials SignupService via the service-acting client with an EMPTY tenant', async () => {
    mockRequest.mockResolvedValue({});
    await requestSignupVerification({
      attemptId: 'attempt-1',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
      clientIp: '203.0.113.7',
    });
    // Empty-tenant contract: same as the unauthenticated SetSignupProgress RPC.
    expect(mockServiceClient).toHaveBeenCalledWith(SignupService, '');
  });

  it('maps the request fields and defaults absent names to empty strings', async () => {
    mockRequest.mockResolvedValue({});
    await requestSignupVerification({
      attemptId: 'attempt-2',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'org',
      clientIp: '203.0.113.7',
    });
    expect(mockRequest).toHaveBeenCalledWith({
      attemptId: 'attempt-2',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'org',
      ownerFirstName: '',
      ownerLastName: '',
      clientIp: '203.0.113.7',
    });
  });

  it('carries NO password on the verification request', async () => {
    mockRequest.mockResolvedValue({});
    await requestSignupVerification({
      attemptId: 'attempt-3',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
      clientIp: '',
    });
    // A password at this point would be a stored credential for an address
    // nobody has yet shown they control.
    expect(mockRequest.mock.calls[0]?.[0]).not.toHaveProperty('password');
  });

  it('returns the redeemed session fields', async () => {
    mockRedeem.mockResolvedValue({
      verifiedSessionToken: 'sess-1',
      attemptId: 'attempt-4',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
    });
    const out = await redeemSignupVerification({
      token: 'raw-token',
      clientIp: '203.0.113.7',
    });
    expect(out).toEqual({
      verifiedSessionToken: 'sess-1',
      attemptId: 'attempt-4',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
    });
  });

  it('maps each step state of the daemon to the dashboard state', async () => {
    const cases: Array<[SignupStepState, string]> = [
      [SignupStepState.WAITING, 'waiting'],
      [SignupStepState.DONE, 'done'],
      [SignupStepState.FAILED, 'failed'],
      [SignupStepState.NONE, 'none'],
      [SignupStepState.UNSPECIFIED, 'none'],
    ];
    for (const [state, want] of cases) {
      mockGetStep.mockResolvedValueOnce({ state });
      await expect(getSignupStep('attempt-6')).resolves.toBe(want);
    }
    expect(mockGetStep).toHaveBeenCalledWith({ attemptId: 'attempt-6' });
  });

  it('completes with the session and password ONLY', async () => {
    mockSignup.mockResolvedValue({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      stepUrl: 'https://billing.example.test/step',
      stepToken: 'opaque',
    });

    const result = await completeSignupOwner({
      attemptId: 'attempt-5',
      verifiedSessionToken: 'sess-1',
      password: 'Passw0rd!Test',
      clientIp: '203.0.113.7',
    });

    expect(mockSignup).toHaveBeenCalledWith({
      attemptId: 'attempt-5',
      verifiedSessionToken: 'sess-1',
      password: 'Passw0rd!Test',
      clientIp: '203.0.113.7',
    });

    // Nothing that names the signup may travel on this call — the daemon reads
    // all of it from the verification row instead.
    const sent = mockSignup.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const forbidden of [
      'ownerEmail',
      'workspaceName',
      'tier',
      'ownerFirstName',
      'ownerLastName',
    ]) {
      expect(sent).not.toHaveProperty(forbidden);
    }

    expect(result).toEqual({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      stepUrl: 'https://billing.example.test/step',
      stepToken: 'opaque',
    });
  });
});
