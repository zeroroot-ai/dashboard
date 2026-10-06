// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * The registration queue client (dashboard#193, gibson#620): it reads
 * registration_id, and names the id in each decision.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { list, approve, reject } = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));
vi.mock('../../gibson-client', () => ({
  userClient: () => ({
    adminListPendingRegistrations: list,
    adminApproveRegistration: approve,
    adminRejectRegistration: reject,
  }),
}));

import {
  daemonApproveRegistration,
  daemonListPendingRegistrations,
  daemonRejectRegistration,
} from '../registrations';

beforeEach(() => {
  list.mockReset();
  approve.mockReset();
  reject.mockReset();
});

describe('registrations client', () => {
  it('maps each pending registration, the id included', async () => {
    list.mockResolvedValue({
      registrations: [
        {
          registrationId: 'reg-1',
          ownerEmail: 'ada@example.test',
          workspaceName: 'Analytical',
          tier: 'team',
          ownerFirstName: 'Ada',
          ownerLastName: 'Lovelace',
        },
      ],
    });
    await expect(daemonListPendingRegistrations()).resolves.toEqual([
      {
        registrationId: 'reg-1',
        ownerEmail: 'ada@example.test',
        workspaceName: 'Analytical',
        tier: 'team',
        ownerFirstName: 'Ada',
        ownerLastName: 'Lovelace',
      },
    ]);
    expect(list).toHaveBeenCalledWith({ limit: 200 });
  });

  it('names the registration in an approval and returns the queued tenant', async () => {
    approve.mockResolvedValue({ tenantId: 'analytical', ownerUserId: 'u1', planId: 'team' });
    await expect(daemonApproveRegistration('reg-1')).resolves.toEqual({
      tenantId: 'analytical',
      ownerUserId: 'u1',
      planId: 'team',
    });
    expect(approve).toHaveBeenCalledWith({ registrationId: 'reg-1' });
  });

  it('sends the reason with a rejection', async () => {
    reject.mockResolvedValue({});
    await daemonRejectRegistration('reg-2', 'Unknown company');
    expect(reject).toHaveBeenCalledWith({ registrationId: 'reg-2', reason: 'Unknown company' });
  });
});
