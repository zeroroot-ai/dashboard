/**
 * `assertAuthorized` — server-side authz defense-in-depth helper.
 *
 * Applies the same registry-driven decision logic as `useAuthorize` but runs
 * in a Server Action or Route Handler context. Throws `AuthzDeniedError` when
 * the caller is not allowed to invoke `method`.
 *
 * Server actions MUST call this at the top of every function wrapping a daemon
 * admin RPC — before any Zod parse, before any daemon call, before any
 * side-effecting code.
 *
 * Security contract:
 *   - This is defense-in-depth. The daemon + ext-authz still enforce. The
 *     dashboard's check is an additional layer that prevents the RPC from
 *     ever being forwarded for unauthorized callers.
 *   - Error messages NEVER include role lists, FGA tuples, or tenant data.
 *     They carry only the method name and a short reason code.
 *
 * Spec: dashboard-authz-ui-gating Requirement 3.
 *
 * @module auth/assert-authorized
 */

import 'server-only';

import { auth } from '@/auth';
import { AuthRegistry, IdentityClass } from '@/src/gen/authz/registry';
import { satisfiesRelation } from './relation-hierarchy';
import { getMyMemberships } from './membership';
import { readRawActiveTenant } from './active-tenant';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertAuthorized` when the current session is not permitted to
 * call `method`.
 *
 * Fields:
 *   - `method`  — the fully-qualified gRPC method path that was denied.
 *   - `reason`  — a short machine-readable reason code.
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
      | 'relation-not-met',
  ) {
    super(`assertAuthorized: ${reason} for ${method}`);
    this.name = 'AuthzDeniedError';
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Assert that the current session is authorized to call `method`.
 *
 * @param method - Fully-qualified gRPC method path, e.g.
 *   `"/gibson.admin.v1.SecretsAdminService/SetSecret"`.
 *
 * @throws {AuthzDeniedError} with a structured `reason` when the check fails.
 *
 * @returns {Promise<void>} resolves silently when allowed.
 */
export async function assertAuthorized(method: string): Promise<void> {
  const entry = AuthRegistry[method];

  // Unknown method: allow (don't block new RPCs not yet in registry).
  if (!entry) return;

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

  // Resolve active tenant from the HMAC-signed cookie.
  const rawTenant = await readRawActiveTenant();
  if (rawTenant.status !== 'present' || !rawTenant.tenantId) {
    throw new AuthzDeniedError(method, 'no-active-tenant');
  }
  const activeTenantId = rawTenant.tenantId;

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

  // Map internal role ('admin'/'member') to FGA relation string.
  const fgaRole = membership.role === 'admin' ? 'tenant_admin' : 'tenant_member';

  if (!satisfiesRelation(fgaRole, entry.relation)) {
    throw new AuthzDeniedError(method, 'relation-not-met');
  }
}
