/**
 * Contract tests for the absolute session lifetime (GHSA-rwc3, session half).
 *
 * The defect: `session.maxAge` with the jwt strategy is an IDLE timeout, not a
 * session lifetime. Auth.js re-mints the JWT with a fresh `exp` on every server
 * render, so a tab that polls extends the session forever and a login never has
 * to be revalidated against the IdP. The fix stamps `authIssuedAt` once at
 * sign-in and refuses to re-mint past the cap.
 */

import { describe, it, expect } from 'vitest';

import {
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  SESSION_IDLE_MAX_AGE_SECONDS,
  isSessionBeyondAbsoluteCap,
} from '../session-lifetime';

const NOW = 1_800_000_000; // fixed clock, seconds

describe('absolute session cap', () => {
  it('defines a finite cap', () => {
    expect(SESSION_ABSOLUTE_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(Number.isFinite(SESSION_ABSOLUTE_MAX_AGE_SECONDS)).toBe(true);
  });

  it('is longer than the idle window so normal work is uninterrupted', () => {
    expect(SESSION_ABSOLUTE_MAX_AGE_SECONDS).toBeGreaterThan(
      SESSION_IDLE_MAX_AGE_SECONDS,
    );
  });

  it('admits a session that started within the cap', () => {
    const justStarted = NOW - 60;
    expect(isSessionBeyondAbsoluteCap(justStarted, NOW)).toBe(false);

    const oneSecondInside = NOW - (SESSION_ABSOLUTE_MAX_AGE_SECONDS - 1);
    expect(isSessionBeyondAbsoluteCap(oneSecondInside, NOW)).toBe(false);
  });

  it('rejects a session at or past the cap regardless of recent activity', () => {
    const exactlyAtCap = NOW - SESSION_ABSOLUTE_MAX_AGE_SECONDS;
    expect(isSessionBeyondAbsoluteCap(exactlyAtCap, NOW)).toBe(true);

    const wellPast = NOW - SESSION_ABSOLUTE_MAX_AGE_SECONDS * 10;
    expect(isSessionBeyondAbsoluteCap(wellPast, NOW)).toBe(true);
  });

  it('is NOT extended by activity', () => {
    // The whole point: the stamp is fixed at sign-in, so evaluating it again
    // later (a "render" that would previously have re-minted `exp`) still
    // measures from the original login.
    const signedInAt = NOW - SESSION_ABSOLUTE_MAX_AGE_SECONDS + 10;
    expect(isSessionBeyondAbsoluteCap(signedInAt, NOW)).toBe(false);
    // 20 seconds of continuous activity later, the same stamp is now past cap.
    expect(isSessionBeyondAbsoluteCap(signedInAt, NOW + 20)).toBe(true);
  });

  it('rejects a token carrying no stamp', () => {
    // Sessions minted before the cap existed, and any token where the stamp was
    // stripped. There is no honest way to date these, so they end.
    expect(isSessionBeyondAbsoluteCap(undefined, NOW)).toBe(true);
    expect(isSessionBeyondAbsoluteCap(null, NOW)).toBe(true);
  });

  it('rejects a non-numeric or non-finite stamp rather than trusting it', () => {
    expect(isSessionBeyondAbsoluteCap('1800000000', NOW)).toBe(true);
    expect(isSessionBeyondAbsoluteCap(Number.NaN, NOW)).toBe(true);
    expect(isSessionBeyondAbsoluteCap(Number.POSITIVE_INFINITY, NOW)).toBe(true);
    expect(isSessionBeyondAbsoluteCap({}, NOW)).toBe(true);
  });
});
