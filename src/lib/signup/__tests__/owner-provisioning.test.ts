/**
 * Unit tests for provisionSignupOwner.
 *
 * E9 (dashboard#812): owner provisioning runs daemon-side via the
 * unauthenticated gibson.tenant.v1.SignupService.Signup RPC. This module
 * dials it through the SAME service-acting transport (`serviceClient(Service,
 * '')`, empty tenant) the unauthenticated SetSignupProgress RPC uses — NOT the
 * tenant-scoped userClient. These tests assert the request mapping and the
 * empty-tenant transport contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSignup, mockServiceClient } = vi.hoisted(() => {
  const mockSignup = vi.fn();
  const mockServiceClient = vi.fn(() => ({ signup: mockSignup }));
  return { mockSignup, mockServiceClient };
});

vi.mock('@/src/lib/gibson-client', () => ({
  serviceClient: mockServiceClient,
}));

import { provisionSignupOwner } from '../owner-provisioning';
import { SignupService } from '@/src/gen/gibson/tenant/v1/signup_pb';

describe('provisionSignupOwner', () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockServiceClient.mockClear();
  });

  it('dials SignupService via the service-acting client with an EMPTY tenant', async () => {
    mockSignup.mockResolvedValue({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      alreadyExisted: false,
    });

    await provisionSignupOwner({
      attemptId: 'attempt-1',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
      password: 'Passw0rd!Test',
    });

    // Empty-tenant contract: same as the unauthenticated SetSignupProgress RPC.
    expect(mockServiceClient).toHaveBeenCalledWith(SignupService, '');
  });

  it('maps inputs to the SignupRequest fields, defaulting optionals to empty strings', async () => {
    mockSignup.mockResolvedValue({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      alreadyExisted: true,
    });

    const result = await provisionSignupOwner({
      attemptId: 'attempt-2',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'org',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      stripeCustomerId: 'cus_42',
      password: 'Passw0rd!Test',
    });

    expect(mockSignup).toHaveBeenCalledWith({
      attemptId: 'attempt-2',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'org',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      stripeCustomerId: 'cus_42',
      password: 'Passw0rd!Test',
    });

    expect(result).toEqual({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      alreadyExisted: true,
    });
  });

  it('defaults absent optional fields to empty strings on the wire', async () => {
    mockSignup.mockResolvedValue({
      tenantId: 'acme',
      ownerUserId: 'u-1',
      alreadyExisted: false,
    });

    await provisionSignupOwner({
      attemptId: 'attempt-3',
      ownerEmail: 'owner@acme.test',
      workspaceName: 'Acme',
      tier: 'team',
      password: 'pw',
    });

    expect(mockSignup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerFirstName: '',
        ownerLastName: '',
        stripeCustomerId: '',
      }),
    );
  });
});
