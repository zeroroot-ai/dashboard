/**
 * Policy tests for the breached-password gate.
 *
 * `hibp.ts` answers the factual question and is tested separately. This suite
 * pins the POLICY the dashboard applies to that answer, which is the half that
 * was missing entirely: `isPasswordBreached` had no non-test caller while the
 * Helm chart advertised `hibp.enabled: true`.
 *
 * Refs GHSA-8jw6-8w8q-3v4q residual.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsPasswordBreached, mockEmitAuthAudit, mockInc } = vi.hoisted(() => ({
  mockIsPasswordBreached: vi.fn(),
  mockEmitAuthAudit: vi.fn(),
  mockInc: vi.fn(),
}));

vi.mock('@/src/lib/auth/hibp', () => ({
  isPasswordBreached: mockIsPasswordBreached,
}));
vi.mock('@/src/lib/audit/auth', () => ({
  emitAuthAudit: mockEmitAuthAudit,
}));
vi.mock('@/src/lib/metrics/auth', () => ({
  hibpChecks: { inc: mockInc },
}));

import { assertPasswordNotBreached } from '../breached-password-gate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertPasswordNotBreached', () => {
  it('refuses a password that is in the breach corpus', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: true, count: 24230577 });

    const decision = await assertPasswordNotBreached('hunter2', 'signup', 'u@example.com');

    expect(decision).toEqual({ allowed: false, count: 24230577 });
    expect(mockInc).toHaveBeenCalledWith({ outcome: 'breached' });
  });

  it('allows a password that is not in the corpus', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: false, count: 0 });

    const decision = await assertPasswordNotBreached('correct-horse', 'signup');

    expect(decision).toEqual({ allowed: true });
    expect(mockInc).toHaveBeenCalledWith({ outcome: 'clean' });
    expect(mockEmitAuthAudit).not.toHaveBeenCalled();
  });

  it('fails OPEN when HIBP is unreachable, and audits it', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: 'unknown', reason: 'timeout' });

    const decision = await assertPasswordNotBreached('anything', 'signup', 'u@example.com');

    expect(decision).toEqual({ allowed: true });
    expect(mockInc).toHaveBeenCalledWith({ outcome: 'unknown' });
    expect(mockEmitAuthAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hibp_unavailable',
        outcome: 'failed',
        userId: 'u@example.com',
        reason: 'signup:timeout',
      }),
    );
  });

  it('does not raise an availability event when an operator disabled the check', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: 'unknown', reason: 'disabled' });

    const decision = await assertPasswordNotBreached('anything', 'signup');

    expect(decision).toEqual({ allowed: true });
    // Still counted, so the disabled case is visible on the dashboard...
    expect(mockInc).toHaveBeenCalledWith({ outcome: 'unknown' });
    // ...but not alerted on, or every install with the flag off pages someone.
    expect(mockEmitAuthAudit).not.toHaveBeenCalled();
  });

  it('never puts the password in an audit line', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: 'unknown', reason: 'http_503' });

    await assertPasswordNotBreached('s3cr3t-p4ssw0rd', 'signup', 'u@example.com');

    const emitted = JSON.stringify(mockEmitAuthAudit.mock.calls);
    expect(emitted).not.toContain('s3cr3t-p4ssw0rd');
  });

  it('passes the password through to the lookup unchanged', async () => {
    mockIsPasswordBreached.mockResolvedValue({ breached: false, count: 0 });

    await assertPasswordNotBreached('  spaces matter  ', 'signup');

    expect(mockIsPasswordBreached).toHaveBeenCalledWith('  spaces matter  ');
  });
});
