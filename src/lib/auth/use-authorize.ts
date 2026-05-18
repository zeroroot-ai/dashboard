/**
 * `useAuthorize` — client-side authz decision hook.
 *
 * Looks up `method` in the generated `AuthRegistry` and checks whether the
 * current user is allowed to call it, based on their role on the active
 * tenant. Wraps the membership fetch in React Query for in-page caching.
 *
 * Decision flow:
 *   1. Unknown method → DENIED (fail-closed). No environment-dependent
 *      escape hatch — same behaviour in dev and prod.
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
 * Sister-spec: cross-repo-cohesion-fixes Requirement 1.
 * Sister-spec: eliminate-permissive-authz Requirement 2 — the
 *   non-prod escape-hatch env var was deleted.
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
 *
 * The optional `reason` field is populated on deny paths to help developers
 * diagnose issues. Do not surface it in user-visible messages.
 */
export interface AuthorizeResult {
  /** Whether the current user is allowed to call the method. */
  allowed: boolean;
  /**
   * True while the membership query is in flight. Callers should render
   * nothing (or a neutral skeleton) until `loading` is false.
   */
  loading: boolean;
  /**
   * Machine-readable deny reason. Populated when `allowed` is false and the
   * cause is deterministic (not a loading state). Useful for diagnostics.
   * Do NOT render this in user-visible error messages.
   */
  reason?: string;
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

  // useQuery must be called unconditionally (React hooks rules). The `enabled`
  // flag prevents the network request when we already have a definitive answer
  // without async data (unknown method, unauthenticated RPC, service-only RPC).
  const needsMembershipCheck =
    !!entry &&
    !entry.unauthenticated &&
    (entry.allowedIdentities & IdentityClass.USER) !== 0;

  const { data: memberships, isLoading, isError } = useQuery({
    queryKey: MY_MEMBERSHIPS_QUERY_KEY,
    queryFn: fetchMyMemberships,
    staleTime: 60_000,
    retry: 1,
    enabled: needsMembershipCheck,
  });

  // Unknown method: DENY (fail-closed). No environment-dependent escape
  // hatch. Same behaviour in dev and prod: a registry miss is always a
  // programming error.
  if (!entry) {
    return { allowed: false, loading: false, reason: 'unknown_method' };
  }

  // Unauthenticated RPC: publicly callable, no identity required.
  if (entry.unauthenticated) {
    return { allowed: true, loading: false };
  }

  // SERVICE-only RPC: a browser session is always USER — deny immediately.
  if ((entry.allowedIdentities & IdentityClass.USER) === 0) {
    return { allowed: false, loading: false };
  }

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
