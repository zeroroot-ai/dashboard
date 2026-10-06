// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tenant-membership lookup for the authenticated user.
 *
 * Calls the daemon's `gibson.daemon.v1.DaemonService/ListMyMemberships` RPC
 * via the user-acting transport (`gibson-client.ts`'s shared transport). At
 * the wire level the RPC is registered `unauthenticated: false` (identity is
 * required, validated by Envoy jwt_authn + ext-authz) but carries no
 * per-tenant FGA relation (the response IS the tenant list). The dashboard
 * fetches it with `{ enforceAuthz: false }` on its own client (see
 * `membershipsClient()` below), because the membership bootstrap cannot wait
 * on the membership check it exists to answer (dashboard#107).
 *
 * Caching strategy (security-hardening R17, revised 2026-09-29):
 *
 *   1. Per-request memoization via `react.cache()` keeps a single render
 *      from hammering the daemon when 50+ Server Components on a page all
 *      ask `useAuthorize` / `assertAuthorized` for membership data. This
 *      layer has zero TTL and zero cross-request scope.
 *
 *   2. A per-process verdict cache, keyed by the caller's `sub`, for
 *      MEMBERSHIP_VERDICT_TTL_MS. The middleware asks "is this person still
 *      a member of their tenant?" on EVERY browser request, and one page
 *      load is about fifty requests in one second (route prefetches, RSC
 *      payloads, API polls). Each ask was one ListMyMemberships RPC through
 *      the edge, whose per-person limit on authenticated API calls is fifty
 *      per second (blocker 4, `api_authenticated`). Measured 2026-09-29 on
 *      staging: every sign-in tripped the limit five times, the RPC came
 *      back UNAVAILABLE, and the middleware sent the person to
 *      `/login/error?reason=daemon_unavailable` for a membership they held.
 *      The bound this cache sets: a grant shows at once (an empty result
 *      is never cached), an error is never cached, and a revocation takes
 *      effect on each replica within the TTL. ADR-0093 rejected trusting a
 *      token claim because a removal would wait for token expiry, hours;
 *      this waits seconds, and the verdict still comes from FGA through the
 *      daemon, never from the cookie. Concurrent reads share one in-flight
 *      RPC, so the fifty requests of one page load cost one call.
 *
 * The daemon's UserService.InvalidateMembershipCache deletes a Redis key
 * (`dashboard:memberships:user:<sub>`) that nothing writes; the cache this
 * module invalidates is its own.
 *
 * @module auth/membership
 */

import 'server-only';

import { cache } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { z } from 'zod';

import { auth } from '@/auth';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import { userClient } from '@/src/lib/gibson-client/transport';
import { logger } from '@/src/lib/logger';
import { recordMembershipResolution } from '@/src/lib/metrics/auth';

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

/**
 * One tenant the caller is a member of, with the caller's role.
 *
 * `tenantId` is the FGA object id; `tenantName` is best-effort and falls
 * back to `tenantId` when the daemon's name cache misses.
 */
export type Membership = {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: 'owner' | 'admin' | 'writer' | 'member';
};

/**
 * Reason classifier for membership-resolution failures. The middleware /
 * route handler maps this to a `/login/error?reason=<code>` URL.
 *
 * `permission_denied` and `unauthenticated` cover the two ext-authz / FGA
 * deny shapes (ConnectRPC codes 7 and 16). They must NOT be conflated with
 * `daemon_unavailable` (code 14), surfacing a permission failure as
 * "Service unavailable" misattributes the cause and tells the user to retry
 * where no retry would help. See dashboard#45.
 */
export type MembershipResolutionReason =
  | 'unauthenticated'
  | 'permission_denied'
  | 'daemon_unavailable'
  | 'fga_unavailable'
  | 'malformed_response'
  | 'unknown';

export class MembershipResolutionError extends Error {
  readonly reason: MembershipResolutionReason;
  /**
   * The underlying ConnectRPC code label (e.g. `"permission_denied"`,
   * `"unavailable"`), captured at throw time when the cause was a
   * ConnectError. Used by the middleware's `auth.login_error` log entry
   * so log review can correlate the user-facing reason with the wire-level
   * failure mode. Undefined when the failure was non-Connect (e.g. Zod
   * parse error, no session).
   */
  readonly connectCode?: string;
  constructor(
    reason: MembershipResolutionReason,
    cause?: unknown,
    connectCode?: string,
  ) {
    super(`membership resolution failed: ${reason}`, { cause });
    this.name = 'MembershipResolutionError';
    this.reason = reason;
    this.connectCode = connectCode;
  }
}

// ---------------------------------------------------------------------------
// Wire-format validation
// ---------------------------------------------------------------------------

const MembershipSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string(),
  role: z.string(),
});

/**
 * Normalize an arbitrary role string from the daemon into the strict
 * `'owner' | 'admin' | 'writer' | 'member'` shape this module promises: the
 * four tenant roles of ADR-0093 decision 2 (Owner, Admin, Editor, Viewer)
 * under their FGA relation names. Anything outside that set is treated as
 * `"member"` (lowest privilege), so drift can only lose rights, never grant.
 */
function normalizeRole(raw: string): 'owner' | 'admin' | 'writer' | 'member' {
  if (raw === 'owner') return 'owner';
  if (raw === 'admin') return 'admin';
  if (raw === 'writer') return 'writer';
  return 'member';
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Build a daemon client that authenticates as the current user. Sends NO
 * `x-gibson-tenant` header, same as every user-acting call now (ADR-0093
 * decision 4).
 *
 * `ListMyMemberships` is registered `unauthenticated: false` in the authz
 * registry (`src/gen/authz/registry.ts`): the daemon requires a user token
 * for it, which is correct at the wire level. But the dashboard's own
 * `assertAuthorized` reads a NOT-unauthenticated entry as "resolve the
 * caller's membership first," and resolving membership means calling
 * `getMyMemberships()`, which calls this RPC. Routing that call through the
 * default `userClient(DaemonService)` (authz enforced) re-entered
 * `assertAuthorized("ListMyMemberships")`, which called `getMyMemberships()`
 * again, forever: dashboard#107, 6,244 pending `ListMyMemberships` calls
 * stuck in the interceptor chain of ONE request.
 *
 * `{ enforceAuthz: false }` breaks the cycle: the membership bootstrap must
 * never be gated on membership. The daemon's own FGA check still applies to
 * the RPC; only the dashboard's redundant pre-check is skipped here, the
 * same way `userServiceClient()` below skips it for
 * `InvalidateMembershipCache`.
 */
function membershipsClient() {
  return userClient(DaemonService, { enforceAuthz: false });
}

/**
 * Build a user-acting UserService client for membership cache invalidation.
 * The registry entry for InvalidateMembershipCache requires an active
 * tenant + membership, but this is called right after mutations (e.g.
 * accepting a fresh invitation) that may run before the caller's membership
 * can be assumed already resolvable, so the per-RPC authz interceptor is
 * disabled here; the daemon's own FGA check still applies.
 */
function userServiceClient() {
  return userClient(UserService, { enforceAuthz: false });
}

// ---------------------------------------------------------------------------
// Per-process verdict cache (caching strategy 2 above)
// ---------------------------------------------------------------------------

/** How long one positive membership verdict is reused, per process. */
export const MEMBERSHIP_VERDICT_TTL_MS = 30_000;

type VerdictEntry = {
  readonly promise: Promise<Membership[]>;
  readonly expiresAt: number;
};

/** Keyed by the caller's `sub`. Holds in-flight and settled positive verdicts. */
const verdictCache = new Map<string, VerdictEntry>();

/**
 * One membership read for `userId`: the cached in-flight or settled verdict
 * while it is fresh, else a new daemon call that concurrent readers share.
 * Only a non-empty result stays cached; an empty list or a failure is
 * dropped as soon as it settles, so a grant and an outage are both seen at
 * once.
 */
function readVerdict(userId: string): Promise<Membership[]> {
  const now = Date.now();
  const hit = verdictCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = fetchMembershipsFromDaemon();
  const entry: VerdictEntry = { promise, expiresAt: now + MEMBERSHIP_VERDICT_TTL_MS };
  verdictCache.set(userId, entry);
  promise.then(
    (memberships) => {
      if (memberships.length === 0 && verdictCache.get(userId) === entry) {
        verdictCache.delete(userId);
      }
    },
    () => {
      if (verdictCache.get(userId) === entry) verdictCache.delete(userId);
    },
  );
  return promise;
}

/** Test-only helper: forget every cached verdict between tests. */
export function __clearMembershipVerdictCacheForTests(): void {
  verdictCache.clear();
}

// ---------------------------------------------------------------------------
// Membership cache invalidation
// ---------------------------------------------------------------------------

/** Test-only counter for daemon RPC calls. Exported for assertions. */
let _daemonCallCount = 0;
/** Test-only helper: read the daemon-call counter without leaking the let. */
export function __getDaemonCallCountForTests(): number {
  return _daemonCallCount;
}
/** Test-only helper: zero the daemon-call counter between tests. */
export function __resetDaemonCallCountForTests(): void {
  _daemonCallCount = 0;
}

/**
 * Invalidate the cached membership list for a single user: this process's
 * verdict cache first, then the daemon's InvalidateMembershipCache RPC.
 *
 * Called by callers that mutate membership through their own paths (e.g.
 * accept-invitation server actions) and want to ensure the next read sees
 * the new state.
 */
export async function invalidateMembershipCache(userId: string): Promise<void> {
  if (!userId) return;
  verdictCache.delete(userId);
  try {
    await userServiceClient().invalidateMembershipCache({ userId });
  } catch (err) {
    logger.warn(
      { err, scope: 'auth.membership.invalidate' },
      'membership cache invalidation failed (non-fatal)',
    );
  }
}

// ---------------------------------------------------------------------------
// Inner fetch
// ---------------------------------------------------------------------------

/**
 * Inner fetch, calls the daemon and parses the response. No caching.
 * Increments `_daemonCallCount` on every call, used by the R17 cache
 * tests to assert the request-collapse property.
 */
async function fetchMembershipsFromDaemon(): Promise<Membership[]> {
  _daemonCallCount += 1;
  const startedAt = performance.now();
  try {
    const memberships = await resolveMembershipsFromDaemon();
    recordMembershipResolution('ok', (performance.now() - startedAt) / 1000);
    return memberships;
  } catch (err) {
    recordMembershipResolution(
      err instanceof MembershipResolutionError ? err.reason : 'unknown',
      (performance.now() - startedAt) / 1000,
    );
    throw err;
  }
}

async function resolveMembershipsFromDaemon(): Promise<Membership[]> {
  let raw: unknown;
  try {
    const client = membershipsClient();
    raw = await client.listMyMemberships({});
  } catch (err) {
    if (err instanceof ConnectError) {
      const codeLabel = Code[err.code];
      switch (err.code) {
        case Code.Unauthenticated:
          // No valid session at the JWT/ext-authz layer.
          throw new MembershipResolutionError('unauthenticated', err, codeLabel);
        case Code.PermissionDenied:
          // JWT validated, but FGA / ext-authz denied this specific RPC.
          // Pre-dashboard#45 this fell through to the generic
          // `daemon_unavailable` branch below, surfacing as the wrong
          // "Service unavailable / please retry" UX.
          throw new MembershipResolutionError('permission_denied', err, codeLabel);
        case Code.Unavailable:
        case Code.DeadlineExceeded:
          throw new MembershipResolutionError('daemon_unavailable', err, codeLabel);
        case Code.Internal:
          // The daemon returns Internal when FGA fails inside ListMyMemberships.
          throw new MembershipResolutionError('fga_unavailable', err, codeLabel);
        default:
          // Any other ConnectRPC code is genuinely unknown, surfacing as
          // `daemon_unavailable` would falsely say that the platform is not
          // reachable. The generic error page is the honest UX.
          throw new MembershipResolutionError('unknown', err, codeLabel);
      }
    }
    // Non-ConnectError path: typically a transport-layer failure before
    // a code could be assigned. Surface as daemon_unavailable since the
    // call genuinely didn't land.
    throw new MembershipResolutionError('daemon_unavailable', err);
  }

  // protoc-gen-es emits `memberships` as a camelCased array on the response.
  const items = (raw as { memberships?: unknown[] })?.memberships ?? [];
  const parsed: Membership[] = [];
  for (const item of items) {
    const result = MembershipSchema.safeParse(item);
    if (!result.success) {
      throw new MembershipResolutionError('malformed_response', result.error);
    }
    parsed.push({
      tenantId: result.data.tenantId,
      tenantName: result.data.tenantName || result.data.tenantId,
      role: normalizeRole(result.data.role),
    });
  }
  return parsed;
}

export const getMyMemberships = cache(async (): Promise<Membership[]> => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new MembershipResolutionError('unauthenticated');
  }

  return readVerdict(session.user.id);
});
