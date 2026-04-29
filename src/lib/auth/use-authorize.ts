/**
 * `useAuthorize` — client-side authz decision hook.
 *
 * Looks up `method` in the generated `AuthRegistry` and checks whether the
 * current user is allowed to call it, based on their role on the active
 * tenant. Wraps the membership fetch in React Query for in-page caching.
 *
 * Decision flow:
 *   1. Unknown method → allowed (never block UI for RPCs not yet in registry).
 *   2. entry.unauthenticated → allowed (public RPC; no identity required).
 *   3. allowedIdentities excludes USER → denied immediately (service-only RPC).
 *   4. Membership query loading → { allowed: false, loading: true } (hides UI,
 *      avoids flash-of-visible-admin-chrome).
 *   5. No role for active tenant → denied.
 *   6. satisfiesRelation(role, entry.relation) → allowed / denied.
 *
 * IMPORTANT: `loading: true` MUST be treated as "not allowed" by every caller.
 * Render `null` when `loading || !allowed`.
 *
 * Spec: dashboard-authz-ui-gating Requirement 2.
 *
 * @module auth/use-authorize
 */

'use client';

import { useQuery } from '@tanstack/react-query';

import { AuthRegistry, IdentityClass } from '@/src/gen/authz/registry';
import { satisfiesRelation } from './relation-hierarchy';
import { fetchMyMemberships } from './client-memberships';

/**
 * The return type of `useAuthorize`.
 *
 * Callers MUST check `loading` first. While `loading === true`, treat the
 * result as denied to prevent flash-of-visible-admin-chrome (FOUC).
 */
export interface AuthorizeResult {
  /** Whether the current user is allowed to call the method. */
  allowed: boolean;
  /**
   * True while the membership query is in flight. Callers should render
   * nothing (or a neutral skeleton) until `loading` is false.
   */
  loading: boolean;
}

/** Stable singleton for the React Query cache key. */
const MY_MEMBERSHIPS_QUERY_KEY = ['my-memberships'] as const;

/**
 * Determine whether the current session is allowed to call `method`.
 *
 * @param method - Fully-qualified gRPC method path, e.g.
 *   `"/gibson.admin.v1.SecretsAdminService/SetSecret"`.
 */
export function useAuthorize(method: string): AuthorizeResult {
  const entry = AuthRegistry[method];

  // Unknown method: allow. Don't block UI for new RPCs not yet in the registry.
  if (!entry) {
    return { allowed: true, loading: false };
  }

  // Unauthenticated RPC: publicly callable, no identity required.
  if (entry.unauthenticated) {
    return { allowed: true, loading: false };
  }

  // SERVICE-only RPC: a browser session is always USER — deny immediately.
  if ((entry.allowedIdentities & IdentityClass.USER) === 0) {
    return { allowed: false, loading: false };
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks -- hook is called
  // unconditionally at this point; the early returns above only apply when
  // we already have a definitive answer without async data.
  const { data: memberships, isLoading, isError } = useQuery({
    queryKey: MY_MEMBERSHIPS_QUERY_KEY,
    queryFn: fetchMyMemberships,
    staleTime: 60_000,
    retry: 1,
  });

  // While loading (or on error), treat as denied to prevent FOUC.
  if (isLoading || isError || !memberships) {
    return { allowed: false, loading: isLoading };
  }

  const { activeTenantId, byTenant } = memberships;

  if (!activeTenantId) {
    return { allowed: false, loading: false };
  }

  const tenantEntry = byTenant[activeTenantId];
  if (!tenantEntry?.role) {
    return { allowed: false, loading: false };
  }

  return {
    allowed: satisfiesRelation(tenantEntry.role, entry.relation),
    loading: false,
  };
}
