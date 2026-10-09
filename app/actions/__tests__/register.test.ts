// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * registerAction, the registration of the approval rung (dashboard#267).
 *
 * Before this action no dashboard code called SignupService.Register, so on
 * the approval rung nobody could register and the registration queue stayed
 * empty.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

const mockRegister = vi.fn();
const mockProfile = vi.fn();
const mockBreach = vi.fn();

vi.mock('@/src/lib/signup/owner-provisioning', () => ({
  registerForApproval: (...args: unknown[]) => mockRegister(...args),
}));
vi.mock('@/src/lib/deployment-profile', () => ({
  getDeploymentProfile: () => mockProfile(),
}));
vi.mock('@/src/lib/auth/breached-password-gate', () => ({
  assertPasswordNotBreached: (...args: unknown[]) => mockBreach(...args),
}));
vi.mock('@/src/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/src/lib/pricing-display', () => ({
  selfServeTierIds: ['solo', 'team'] as const,
  pricingDisplays: [],
}));

import { registerAction } from '../register';
import { REGISTER_TEXT } from '@/app/(public)/signup/register-texts';

const INPUT = {
  firstName: ' Ada ',
  lastName: 'Lovelace',
  email: 'Ada@Example.com',
  workspaceName: 'Analytical Engines',
  tier: 'solo',
  password: 'correct horse battery staple',
  passwordConfirm: 'correct horse battery staple',
};

describe('registerAction', () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockProfile.mockReset().mockReturnValue({ signupRung: 'approval' });
    mockBreach.mockReset().mockResolvedValue({ allowed: true });
  });

  it('sends the whole form to Register, normalized', async () => {
    mockRegister.mockResolvedValue(undefined);
    expect(await registerAction(INPUT)).toEqual({ ok: true });
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const sent = mockRegister.mock.calls[0][0];
    expect(sent).toMatchObject({
      ownerEmail: 'ada@example.com',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      workspaceName: 'Analytical Engines',
      tier: 'solo',
      password: INPUT.password,
    });
    expect(sent.attemptId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses on any rung but approval, and calls nothing', async () => {
    for (const rung of ['closed', 'open']) {
      mockProfile.mockReturnValue({ signupRung: rung });
      expect(await registerAction(INPUT)).toEqual({ ok: false, userMessage: REGISTER_TEXT.closed });
    }
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('returns field errors for an invalid form, and calls nothing', async () => {
    const result = await registerAction({ ...INPUT, passwordConfirm: 'other' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.passwordConfirm).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('refuses a breached password before the RPC', async () => {
    mockBreach.mockResolvedValue({ allowed: false });
    const result = await registerAction(INPUT);
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: REGISTER_TEXT.breached } });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it.each([
    [Code.AlreadyExists, REGISTER_TEXT.accountExists],
    [Code.ResourceExhausted, REGISTER_TEXT.rateLimited],
    [Code.InvalidArgument, REGISTER_TEXT.invalid],
    [Code.PermissionDenied, REGISTER_TEXT.closed],
    [Code.Unavailable, REGISTER_TEXT.unavailable],
  ])('maps the daemon code %s to a user-safe message', async (code, message) => {
    mockRegister.mockRejectedValue(new ConnectError('x', code));
    expect(await registerAction(INPUT)).toMatchObject({ ok: false, userMessage: message });
  });
});
