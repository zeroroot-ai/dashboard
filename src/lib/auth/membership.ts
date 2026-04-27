/**
 * Tenant-membership lookup for the authenticated user.
 *
 * Calls the daemon's `gibson.daemon.v1.DaemonService/ListMyMemberships` RPC
 * via the user-acting transport (`gibson-client.ts`'s shared transport). The
 * RPC is registered in ext-authz with `unauthenticated: true` — identity is
 * required (validated by Envoy jwt_authn + ext-authz) but no per-tenant FGA
 * gate is performed (the response IS the tenant list).
 *
 * Per-request memoization via `react.cache()` keeps a single render from
 * hammering the daemon; cross-request caching is intentionally NOT done so
 * that membership changes are visible on the next render.
 *
 * @module auth/membership
 */

import 'server-only';

import { cache } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { z } from 'zod';

import { auth } from '@/auth';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { makeClient } from '@/src/lib/gibson-client';
import { requireUserToken } from '@/src/lib/auth/user-token';
import { getFaultMode } from '@/src/lib/test-fixtures/fault-injection';

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
  readonly role: 'admin' | 'member';
};

/**
 * Reason classifier for membership-resolution failures. The middleware /
 * route handler maps this to a `/login/error?reason=<code>` URL.
 */
export type MembershipResolutionReason =
  | 'unauthenticated'
  | 'daemon_unavailable'
  | 'fga_unavailable'
  | 'malformed_response';

export class MembershipResolutionError extends Error {
  readonly reason: MembershipResolutionReason;
  constructor(reason: MembershipResolutionReason, cause?: unknown) {
    super(`membership resolution failed: ${reason}`, { cause });
    this.name = 'MembershipResolutionError';
    this.reason = reason;
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
 * `'admin' | 'member'` shape this module promises. Anything other than
 * `"admin"` is treated as `"member"` — the daemon never emits other values
 * today, but defending against drift is cheap.
 */
function normalizeRole(raw: string): 'admin' | 'member' {
  return raw === 'admin' ? 'admin' : 'member';
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Build a daemon client that authenticates as the current user but does
 * NOT send `x-gibson-tenant`. ListMyMemberships is registered as
 * `unauthenticated: true` in ext-authz (identity is required, but no
 * per-tenant FGA gate runs — the response IS the tenant list), so a
 * tenant header would only confuse audit logs. We can't compose
 * `userClient` here either: that helper reads the active-tenant cookie,
 * but the cookie's validity itself depends on the result of THIS RPC,
 * which would create a circular dependency.
 */
function membershipsClient() {
  return makeClient(DaemonService, requireUserToken, async () => '');
}

/**
 * Returns every tenant the authenticated caller is a member of.
 *
 * Per-request memoized via `react.cache()`: a single render that asks for
 * memberships in three places makes one daemon RPC.
 *
 * @throws {MembershipResolutionError} when the user is not signed in,
 *   the daemon is unreachable, FGA is down, or the response fails Zod
 *   validation. Caller maps `error.reason` to a user-facing route.
 */
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

  let raw: unknown;
  try {
    const client = membershipsClient();
    raw = await client.listMyMemberships({});
  } catch (err) {
    if (err instanceof ConnectError) {
      switch (err.code) {
        case Code.Unauthenticated:
          throw new MembershipResolutionError('unauthenticated', err);
        case Code.Unavailable:
        case Code.DeadlineExceeded:
          throw new MembershipResolutionError('daemon_unavailable', err);
        case Code.Internal:
          // The daemon returns Internal when FGA fails inside ListMyMemberships.
          throw new MembershipResolutionError('fga_unavailable', err);
      }
    }
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
});
