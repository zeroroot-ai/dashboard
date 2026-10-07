// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for ConnectRPC code → MembershipResolutionReason classification
 * + ERROR_COPY page-copy guards. Regression coverage for dashboard#45 -
 * pre-fix, every ConnectRPC code other than Unauthenticated/Unavailable/
 * DeadlineExceeded/Internal silently collapsed to `daemon_unavailable`,
 * which surfaced as "Service unavailable / please retry" on the
 * error page. PermissionDenied (7) in particular was misclassified and
 * sent users to a page that told them to retry a failure that no retry
 * could resolve.
 *
 * Tests assert:
 *   1. Each terminal ConnectRPC code (Unauthenticated, PermissionDenied,
 *      Unavailable, DeadlineExceeded, Internal) maps to a distinct,
 *      semantically-correct MembershipResolutionReason.
 *   2. Unknown ConnectRPC codes (e.g. OutOfRange) map to `unknown`, NOT
 *      `daemon_unavailable`.
 *   3. The thrown `MembershipResolutionError` carries the ConnectRPC code
 *      label in its `connectCode` field so the middleware's `auth.login_error`
 *      log can include it.
 *   4. `ERROR_COPY['permission_denied']` does NOT contain the misleading
 *      "Service unavailable" copy.
 *   6. No entry of `ERROR_COPY` promises a page to an on-call person. No
 *      paging integration exists (dashboard#211).
 *   5. `ERROR_COPY['permission_denied']` provides a sign-OUT CTA, not a
 *      retry-sign-in CTA (which would just repeat the failing call).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Disable react.cache() memoization so each test gets a fresh daemon call.
// ---------------------------------------------------------------------------
vi.mock('react', () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// ---------------------------------------------------------------------------
// Auth.js session, a signed-in user. Tests don't exercise the
// unauthenticated-by-no-session branch.
// ---------------------------------------------------------------------------
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: 'zitadel-sub-test', name: 'Test User' },
  })),
}));

vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'fake-token'),
}));


vi.mock('@/src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// The mock client, per-test we override what `listMyMemberships` throws.
// ---------------------------------------------------------------------------
let listMyMembershipsImpl: () => Promise<unknown>;

vi.mock('@/src/lib/gibson-client/transport', () => ({
  userClient: vi.fn(() => ({
    listMyMemberships: vi.fn(async () => listMyMembershipsImpl()),
  })),
}));

import {
  getMyMemberships,
  MembershipResolutionError,
  __clearMembershipVerdictCacheForTests,
  __resetDaemonCallCountForTests,
} from '../membership';
import { ERROR_COPY } from '../error-codes';

beforeEach(() => {
  __resetDaemonCallCountForTests();
  __clearMembershipVerdictCacheForTests();
});

// ---------------------------------------------------------------------------
// ConnectRPC code → MembershipResolutionReason
// ---------------------------------------------------------------------------

describe('membership error classification, ConnectRPC code mapping', () => {
  const cases: ReadonlyArray<{
    name: string;
    code: Code;
    expectedReason:
      | 'unauthenticated'
      | 'permission_denied'
      | 'daemon_unavailable'
      | 'fga_unavailable'
      | 'unknown';
    expectedCodeLabel: string;
  }> = [
    {
      name: 'Unauthenticated (16) → unauthenticated',
      code: Code.Unauthenticated,
      expectedReason: 'unauthenticated',
      expectedCodeLabel: Code[Code.Unauthenticated],
    },
    {
      name: 'PermissionDenied (7) → permission_denied (was misclassified as daemon_unavailable pre-#45)',
      code: Code.PermissionDenied,
      expectedReason: 'permission_denied',
      expectedCodeLabel: Code[Code.PermissionDenied],
    },
    {
      name: 'Unavailable (14) → daemon_unavailable',
      code: Code.Unavailable,
      expectedReason: 'daemon_unavailable',
      expectedCodeLabel: Code[Code.Unavailable],
    },
    {
      name: 'DeadlineExceeded (4) → daemon_unavailable',
      code: Code.DeadlineExceeded,
      expectedReason: 'daemon_unavailable',
      expectedCodeLabel: Code[Code.DeadlineExceeded],
    },
    {
      name: 'Internal (13) → fga_unavailable',
      code: Code.Internal,
      expectedReason: 'fga_unavailable',
      expectedCodeLabel: Code[Code.Internal],
    },
    {
      name: 'OutOfRange (11, unmapped) → unknown (NOT daemon_unavailable)',
      code: Code.OutOfRange,
      expectedReason: 'unknown',
      expectedCodeLabel: Code[Code.OutOfRange],
    },
  ];

  for (const { name, code, expectedReason, expectedCodeLabel } of cases) {
    it(name, async () => {
      listMyMembershipsImpl = async () => {
        throw new ConnectError('synthetic daemon failure', code);
      };

      let caught: unknown;
      try {
        await getMyMemberships();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(MembershipResolutionError);
      const mre = caught as MembershipResolutionError;
      expect(mre.reason).toBe(expectedReason);
      expect(mre.connectCode).toBe(expectedCodeLabel);
    });
  }

  it('non-ConnectError transport failure → daemon_unavailable (the call truly didn\'t land)', async () => {
    listMyMembershipsImpl = async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    };

    let caught: unknown;
    try {
      await getMyMemberships();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MembershipResolutionError);
    const mre = caught as MembershipResolutionError;
    expect(mre.reason).toBe('daemon_unavailable');
    expect(mre.connectCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ERROR_COPY, guard the page copy that users actually see.
// ---------------------------------------------------------------------------

describe('ERROR_COPY, permission_denied page copy', () => {
  it('does NOT contain the daemon_unavailable "Service unavailable" headline', () => {
    expect(ERROR_COPY.permission_denied.title).not.toMatch(/service unavailable/i);
  });

  it('does NOT reuse the daemon_unavailable text (no retry resolves an FGA denial)', () => {
    expect(ERROR_COPY.permission_denied.description).not.toBe(
      ERROR_COPY.daemon_unavailable.description,
    );
  });

  it('provides a sign-out CTA, not a retry-sign-in CTA', () => {
    expect(ERROR_COPY.permission_denied.cta.href).toMatch(/signout/i);
  });

  it('still has a non-empty description so the user knows what happened', () => {
    expect(ERROR_COPY.permission_denied.description.length).toBeGreaterThan(20);
  });
});

describe('ERROR_COPY, daemon_unavailable page copy (approved text, dashboard#211)', () => {
  it('has the approved title and text', () => {
    expect(ERROR_COPY.daemon_unavailable.title).toBe('Service unavailable');
    expect(ERROR_COPY.daemon_unavailable.description).toBe(
      "We couldn't reach the platform to complete your sign-in. This usually clears within a minute. Please retry.",
    );
  });
});

describe('ERROR_COPY, no entry promises a page to an on-call person', () => {
  it.each(Object.entries(ERROR_COPY))('%s', (_reason, copy) => {
    const text = `${copy.title} ${copy.description} ${copy.cta.label}`;
    expect(text).not.toMatch(/paged/i);
    expect(text).not.toMatch(/on-call/i);
  });
});
