// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * `assertAuthorized`, server-side authz defense-in-depth helper.
 *
 * Applies the same registry-driven decision logic as `useAuthorize` but runs
 * in a Server Action or Route Handler context. Throws `AuthzDeniedError` when
 * the caller is not allowed to invoke `method`.
 *
 * Server actions MUST call this at the top of every function wrapping a daemon
 * admin RPC, before any Zod parse, before any daemon call, before any
 * side-effecting code.
 *
 * Security contract:
 *   - This is defense-in-depth. The daemon + ext-authz still enforce. The
 *     dashboard's check is an additional layer that prevents the RPC from
 *     ever being forwarded for unauthorized callers.
 *   - Error messages NEVER include role lists, FGA tuples, or tenant data.
 *     They carry only the method name and a short reason code.
 *   - Unknown methods are DENIED (fail-closed). The same code runs in dev
 *     and prod: a registry miss is always a programming error and must
 *     throw before the call leaves the process. There is no environment-
 *     dependent escape hatch.
 *   - The decision is OBJECT-AWARE. This helper knows only the caller's role
 *     on the active tenant, so it can only decide entries whose FGA check
 *     runs against that tenant. An entry scoped to one bank, job, component,
 *     plugin or secret names that object in the request body, which this
 *     helper never sees. For such an entry the helper enforces the floor
 *     (a session, a USER-callable RPC, an active tenant, a membership on it)
 *     and then forwards the call: the daemon and ext-authz hold the grant on
 *     the named object and decide the relation. It does not guess and it
 *     does not refuse. Before gibson#1706 no USER-callable RPC was
 *     object-scoped, so the refuse-or-allow shape never met a real call.
 *     See `auth/relation-hierarchy`.
 *
 * Spec: dashboard-authz-ui-gating Requirement 3.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 1.
 * Sister-spec: eliminate-permissive-authz Requirement 2, the
 *   non-prod escape-hatch env var and warn-once log path were deleted.
 *
 * @module auth/assert-authorized
 */

import 'server-only';

import { ConnectError } from '@connectrpc/connect';

import { auth } from '@/auth';
import { AuthRegistry, IdentityClass } from '@/src/gen/authz/registry';
import { decideAuthEntry, scopeOfEntry } from './relation-hierarchy';
import { getMyMemberships } from './membership';
import { requireActiveTenant, NoActiveTenantError, StaleActiveTenantError } from './active-tenant';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertAuthorized` when the current session is not permitted to
 * call `method`.
 *
 * Fields:
 *   - `method` , the fully-qualified gRPC method path that was denied.
 *   - `reason` , a short machine-readable reason code.
 *
 * NEVER include role lists, tenant IDs, FGA data, or session tokens in the
 * message or any field.
 */
export class AuthzDeniedError extends Error {
  constructor(
    public readonly method: string,
    public readonly reason:
      | 'no-session'
      | 'service-only-rpc'
      | 'no-active-tenant'
      | 'not-a-member'
      | 'relation-not-met'
      | 'unknown_method',
  ) {
    super(`assertAuthorized: ${reason} for ${method}`);
    this.name = 'AuthzDeniedError';
  }
}

// ---------------------------------------------------------------------------
// Central denial → action-result mapper (dashboard#904)
// ---------------------------------------------------------------------------

/**
 * Canonical failure shape a server action returns when the caller is not
 * authorized. Matches the `{ ok: false, error, code }` ActionResult
 * convention used across app/actions.
 */
type PermissionDeniedResult = {
  ok: false;
  error: string;
  code: 'permission_denied';
};

/**
 * Central `AuthzDeniedError` → `permission_denied` action-result mapper.
 *
 * Since the per-RPC authz bake-in (dashboard#848 / #902), the denial is
 * thrown from INSIDE the `userClient` RPC dispatch rather than by a manual
 * `assertAuthorized(...)` prologue in each server action (dashboard#904
 * deleted those). Server actions call this FIRST in their daemon-call
 * `catch` to preserve the canonical
 * `{ ok: false, error: 'Permission denied', code: 'permission_denied' }`
 * surface.
 *
 * Returns `null` when `err` is not an authz denial, so the caller falls
 * through to its own error mapping.
 */
export function permissionDeniedResult(
  err: unknown,
): PermissionDeniedResult | null {
  return authzDenial(err)
    ? { ok: false, error: 'Permission denied', code: 'permission_denied' }
    : null;
}

/**
 * The `AuthzDeniedError` behind `err`, or `null` when `err` is not a denial.
 *
 * A denial reaches a caller in one of two shapes. A direct `assertAuthorized`
 * call throws `AuthzDeniedError` itself. A denial from inside an RPC (the
 * transport's authz interceptor) reaches the caller as a `ConnectError`:
 * connect-es passes every error an interceptor throws through
 * `ConnectError.from`, which keeps the original as `cause`. The interceptor
 * throws a `ConnectError` with code `PermissionDenied` and the
 * `AuthzDeniedError` as its cause, so both shapes carry the denial.
 *
 * Measured 2026-09-29 on staging: `instanceof AuthzDeniedError` on the RPC
 * shape was false, so a member who pressed "Enable" on a connector saw the
 * internal-error page with a reference id instead of "Permission denied".
 * Every caller checks through this function, never through `instanceof`
 * (guard: scripts/check-authz-denial-unwrapped.mjs).
 */
export function authzDenial(err: unknown): AuthzDeniedError | null {
  if (err instanceof AuthzDeniedError) return err;
  if (err instanceof ConnectError && err.cause instanceof AuthzDeniedError) {
    return err.cause;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Assert that the current session is authorized to call `method`.
 *
 * @param method - Fully-qualified gRPC method path, e.g.
 *   `"/gibson.secrets.v1.SecretsService/SetSecret"`.
 *
 * @throws {AuthzDeniedError} with a structured `reason` when the check fails.
 *
 * @returns {Promise<void>} resolves silently when allowed.
 */
export async function assertAuthorized(method: string): Promise<void> {
  const entry = AuthRegistry[method];

  // Unknown method: DENY (fail-closed). No environment-dependent escape
  // hatch. Same code runs in dev and prod: a registry miss is always a
  // programming error and must throw before the call leaves the process.
  if (!entry) {
    throw new AuthzDeniedError(method, 'unknown_method');
  }

  // Unauthenticated RPC: no identity required.
  if (entry.unauthenticated) return;

  // Verify session exists.
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthzDeniedError(method, 'no-session');
  }

  // SERVICE-only RPC: a dashboard session is always USER.
  if ((entry.allowedIdentities & IdentityClass.USER) === 0) {
    throw new AuthzDeniedError(method, 'service-only-rpc');
  }

  // Self-mode RPC (gibson.auth.v1 AuthOptions.self): the caller reads its own
  // data, and ext-authz checks no tenant relation for it. A session and the
  // USER class are the whole rule, so stop here. This must return before the
  // membership lookup below: ListMyMemberships IS self-mode, and
  // getMyMemberships() calls it through this same check. Requiring a
  // membership for it made every membership read start another one, until
  // the dashboard ran out of heap after a tenant member signed in (hosted#208).
  if (entry.self) return;

  // The person's tenant, resolved server-side at sign-in (ADR-0093
  // decision 4) and re-validated against current membership just below.
  let activeTenantId: string;
  try {
    activeTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError) {
      throw new AuthzDeniedError(method, 'no-active-tenant');
    }
    // A stale tenant, or a membership read that failed (daemon
    // unavailable): both deny, as the membership lookup below always did.
    throw new AuthzDeniedError(method, 'not-a-member');
  }

  // Resolve memberships and find the caller's role on the active tenant.
  let memberships;
  try {
    memberships = await getMyMemberships();
  } catch {
    // Membership resolution failed (daemon unavailable, etc.).
    throw new AuthzDeniedError(method, 'not-a-member');
  }

  const membership = memberships.find((m) => m.tenantId === activeTenantId);
  if (!membership) {
    throw new AuthzDeniedError(method, 'not-a-member');
  }

  // Object scope first, then relation. An entry whose FGA check runs against
  // one bank, job, component, plugin or secret names that object in the
  // request body, which this check never sees. The floor above still holds
  // (session, USER identity, active tenant, membership). The relation is the
  // daemon's to decide: ext-authz checks the caller's grant on the named
  // object. So the call is forwarded, and a caller without the grant gets
  // PERMISSION_DENIED from the daemon, not from here.
  if (scopeOfEntry(entry) === 'per_object') return;

  const verdict = decideAuthEntry(entry, membership.role);
  if (!verdict.allowed) {
    throw new AuthzDeniedError(method, 'relation-not-met');
  }
}
