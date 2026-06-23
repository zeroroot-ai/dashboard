/**
 * Tenant-membership lookup for the authenticated user.
 *
 * Calls the daemon's `gibson.daemon.v1.DaemonService/ListMyMemberships` RPC
 * via the user-acting transport (`gibson-client.ts`'s shared transport). The
 * RPC is registered in ext-authz with `unauthenticated: true`, identity is
 * required (validated by Envoy jwt_authn + ext-authz) but no per-tenant FGA
 * gate is performed (the response IS the tenant list).
 *
 * Caching strategy (security-hardening R17):
 *
 *   1. Per-request memoization via `react.cache()` keeps a single render
 *      from hammering the daemon when 50+ Server Components on a page all
 *      ask `useAuthorize` / `assertAuthorized` for membership data. This
 *      layer has zero TTL and zero cross-request scope.
 *
 *   2. Cross-request cache via the daemon's UserService.InvalidateMembershipCache
 *      RPC which the dashboard calls after FGA-write mutations. The daemon
 *      owns the Redis layer; the dashboard no longer holds a Redis client.
 *
 * Cache key shape (daemon-side): `dashboard:memberships:user:<sub>`.
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
import { bootstrapClient } from '@/src/lib/gibson-client/transport';
import { getFaultMode } from '@/src/lib/test-fixtures/fault-injection';
import { logger } from '@/src/lib/logger';

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
  readonly role: 'owner' | 'admin' | 'member';
};

/**
 * Reason classifier for membership-resolution failures. The middleware /
 * route handler maps this to a `/login/error?reason=<code>` URL.
 *
 * `permission_denied` and `unauthenticated` cover the two ext-authz / FGA
 * deny shapes (ConnectRPC codes 7 and 16). They must NOT be conflated with
 * `daemon_unavailable` (code 14), surfacing a permission failure as
 * "service unreachable" misattributes the cause and triggers "on-call has
 * been paged" copy where no on-call action would help. See dashboard#45.
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
 * `'owner' | 'admin' | 'member'` shape this module promises. Anything
 * outside that set is treated as `"member"` (lowest privilege), the
 * daemon emits exactly these three today (`tenant.owner` was added in
 * gibson v0.27.0 / spec `tenant-role-taxonomy`), but defending against
 * drift is cheap.
 */
function normalizeRole(raw: string): 'owner' | 'admin' | 'member' {
  if (raw === 'owner') return 'owner';
  if (raw === 'admin') return 'admin';
  return 'member';
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Build a daemon client that authenticates as the current user but does
 * NOT send `x-gibson-tenant`. ListMyMemberships is registered as
 * `unauthenticated: true` in ext-authz (identity is required, but no
 * per-tenant FGA gate runs, the response IS the tenant list), so a
 * tenant header would only confuse audit logs. We can't compose
 * `userClient` here either: that helper reads the active-tenant cookie,
 * but the cookie's validity itself depends on the result of THIS RPC,
 * which would create a circular dependency.
 */
function membershipsClient() {
  // No tenant header: ListMyMemberships IS the tenant-list bootstrap and runs
  // before any active tenant can be validated. `bootstrapClient` is the
  // sanctioned no-tenant wrapper for exactly this boundary (dashboard#814);
  // it brands the empty tenant via unsafeTenantId internally.
  return bootstrapClient(DaemonService);
}

/**
 * Build a user-acting UserService client for membership cache invalidation.
 * Uses empty tenant (InvalidateMembershipCache is scoped by user_id only).
 */
function userServiceClient() {
  // Empty tenant: InvalidateMembershipCache is scoped by user_id only.
  return bootstrapClient(UserService);
}

// ---------------------------------------------------------------------------
// Membership cache invalidation (daemon-delegated)
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
 * Invalidate the cached membership list for a single user.
 *
 * Delegates to the daemon's InvalidateMembershipCache RPC. The daemon owns
 * the Redis layer; the dashboard no longer holds a Redis client.
 *
 * Called by callers that mutate membership through their own paths (e.g.
 * accept-invitation server actions) and want to ensure the next read sees
 * the new state.
 */
export async function invalidateMembershipCache(userId: string): Promise<void> {
  if (!userId) return;
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
          // "service unreachable / on-call has been paged" UX.
          throw new MembershipResolutionError('permission_denied', err, codeLabel);
        case Code.Unavailable:
        case Code.DeadlineExceeded:
          throw new MembershipResolutionError('daemon_unavailable', err, codeLabel);
        case Code.Internal:
          // The daemon returns Internal when FGA fails inside ListMyMemberships.
          throw new MembershipResolutionError('fga_unavailable', err, codeLabel);
        default:
          // Any other ConnectRPC code is genuinely unknown, surfacing as
          // `daemon_unavailable` would falsely page on-call. The generic
          // error page is the honest UX.
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
  // ---------------------------------------------------------------------------
  // TEST FIXTURE: fault injection for the FGA/daemon subsystem.
  // Only active when TEST_FIXTURES_ENABLED=true. In production this is a
  // single env-var boolean check that short-circuits immediately.
  // ---------------------------------------------------------------------------
  const fgaFault = getFaultMode('fga');
  if (fgaFault) {
    fgaFault.decrementIfBounded();
    if (fgaFault.mode === 'malformed-200') {
      // Simulate a 200 response whose body fails Zod validation downstream.
      // We throw MembershipResolutionError('malformed_response') to surface the
      // same path as a real parse failure without making an actual RPC call.
      throw new MembershipResolutionError('malformed_response', new Error('[fault-injection] malformed-200'));
    }
    // "503", "timeout", or any other mode: surface as fga_unavailable.
    throw new MembershipResolutionError('fga_unavailable', new Error(`[fault-injection] ${fgaFault.mode}`));
  }
  // ---------------------------------------------------------------------------

  const session = await auth();
  if (!session?.user?.id) {
    throw new MembershipResolutionError('unauthenticated');
  }

  // The cross-request Redis cache is now managed by the daemon (via the
  // InvalidateMembershipCache RPC). The dashboard no longer holds a Redis
  // client, the per-request react.cache() memoization above is the only
  // dashboard-side caching layer. Each request that isn't memoized within
  // the same render will hit the daemon, which applies its own server-side
  // cache (keyed on user sub, short TTL).
  return fetchMembershipsFromDaemon();
});
