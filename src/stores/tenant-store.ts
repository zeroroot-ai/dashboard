'use client';

/**
 * Tenant store shim — session-backed, no Zustand, no localStorage.
 *
 * The Zustand persist store has been removed.  Tenant identity now lives
 * exclusively in the Auth.js JWT cookie (OIDC `gibson:tenant` claim).
 *
 * This module re-exports the same selector-hook API that the 8 data hooks
 * (useMissions, useComponents, etc.) depend on so they require zero changes.
 * Each hook ultimately only reads `currentTenant?.id` to scope API queries.
 *
 * The `Tenant` object is synthesised from the session tenant slug; full Tenant
 * CRD metadata is not available client-side, which is correct — API routes
 * resolve the full CRD server-side using the tenant ID from the signed JWT.
 *
 * NOTE: `useTenantStore` is intentionally NOT exported — callers that were
 * reaching into the Zustand store directly must migrate to the session-backed
 * selectors below.  The only cross-cutting mutation point is
 * `switchTenantAction` in `app/actions/tenant/switch.ts`.
 */

import { useSession } from 'next-auth/react';
import type { Tenant } from '@/src/types/tenant';

// ---------------------------------------------------------------------------
// Internal: build a minimal Tenant object from the session tenant slug.
// The id and name are both the slug; displayName is title-cased.
// ---------------------------------------------------------------------------

function slugToTenant(slug: string): Tenant {
  const displayName = slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const now = new Date(0); // placeholder — no CRD fetch on client
  return {
    id: slug,
    name: slug,
    displayName,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Internal: extract tenant fields from the Auth.js session.
// The session user is extended in auth.ts with `tenant` and optionally
// `tenants` from Zitadel's custom claim Action (task 2).
// ---------------------------------------------------------------------------

type ExtendedUser = {
  id?: string | null;
  tenant?: string | null;
  tenants?: string[];
};

function useSessionTenants(): {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
} {
  const { data, status } = useSession();
  const ext = (data?.user ?? {}) as ExtendedUser;

  const activeTenantSlug: string | null = ext.tenant ?? null;

  // Build the available list from the multi-value `gibson:tenants` claim.
  // Fall back to a single-element list built from the active slug so that
  // single-tenant users still get a valid `currentTenant`.
  const slugs: string[] =
    ext.tenants && ext.tenants.length > 0
      ? ext.tenants
      : activeTenantSlug
        ? [activeTenantSlug]
        : [];

  const availableTenants: Tenant[] = slugs.map(slugToTenant);
  const currentTenant: Tenant | null = activeTenantSlug
    ? (availableTenants.find((t) => t.id === activeTenantSlug) ??
        slugToTenant(activeTenantSlug))
    : null;

  return {
    currentTenant,
    availableTenants,
    isLoading: status === 'loading',
  };
}

// ---------------------------------------------------------------------------
// useTenantStore — Zustand-compatible selector shim.
//
// The 8 data hooks call `useTenantStore((state) => state.currentTenant)`.
// This shim accepts a selector function and returns the result so those hooks
// continue to compile and work without modification.
//
// Only the subset of TenantState fields that callers actually read is
// implemented; unused fields are no-ops or empty values.
// ---------------------------------------------------------------------------

interface TenantStateCompat {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
  error: null;
  switcherOpen: boolean;
  lastSwitchTimestamp: null;
  setCurrentTenant: (_: unknown) => undefined;
  setAvailableTenants: (_: unknown) => undefined;
  switchTenant: (_id: string, _api: unknown) => Promise<undefined>;
  setSwitcherOpen: (_: unknown) => undefined;
  setLoading: (_: unknown) => undefined;
  setError: (_: unknown) => undefined;
  reset: () => undefined;
}

/**
 * Zustand-selector-compatible hook shim.
 *
 * Builds a TenantState-compatible object from the Auth.js session and passes
 * it through the provided selector.  Read-only fields (currentTenant,
 * availableTenants, isLoading) are live; mutation methods are no-ops — use
 * `switchTenantAction` from `@/app/actions/tenant/switch` for switching.
 *
 * @deprecated Direct callers should migrate to the named selector hooks below.
 */
export function useTenantStore<T>(selector: (state: TenantStateCompat) => T): T {
  const { currentTenant, availableTenants, isLoading } = useSessionTenants();

  const state: TenantStateCompat = {
    currentTenant,
    availableTenants,
    isLoading,
    error: null,
    switcherOpen: false,
    lastSwitchTimestamp: null,
    setCurrentTenant: () => undefined,
    setAvailableTenants: () => undefined,
    switchTenant: async () => undefined,
    setSwitcherOpen: () => undefined,
    setLoading: () => undefined,
    setError: () => undefined,
    reset: () => undefined,
  };

  return selector(state);
}

// ---------------------------------------------------------------------------
// Public selector hooks — same names as the deleted Zustand selectors.
// ---------------------------------------------------------------------------

/**
 * Returns the currently active Tenant (built from `gibson:tenant` claim),
 * or null while the session is loading or unauthenticated.
 */
export function useCurrentTenant(): Tenant | null {
  return useSessionTenants().currentTenant;
}

/**
 * Returns all Tenant objects available to the user (built from
 * `gibson:tenants`).  Single-tenant users get a one-element array.
 */
export function useAvailableTenants(): Tenant[] {
  return useSessionTenants().availableTenants;
}

/**
 * Returns true while the Auth.js session is loading.
 */
export function useTenantLoading(): boolean {
  return useSessionTenants().isLoading;
}

/**
 * Always returns null — errors are surfaced via the switchTenantAction
 * return value and displayed as toasts in tenant-switcher.tsx.
 */
export function useTenantError(): null {
  return null;
}

/**
 * Returns the tenant switcher open state.
 * Retained for API compatibility; switcher open state is now local UI state
 * inside tenant-switcher.tsx and does not need to be shared globally.
 *
 * @deprecated Always returns false. Migrate callers to local useState.
 */
export function useSwitcherOpen(): boolean {
  return false;
}

/**
 * Compatibility shim for callers that destructure tenant action functions.
 * Switching is now performed via `switchTenantAction` (Server Action).
 * Other setters are no-ops — tenant state is driven by the OIDC token.
 *
 * @deprecated Callers should use switchTenantAction from
 *   `@/app/actions/tenant/switch` directly.
 */
export function useTenantActions() {
  return {
    setCurrentTenant: (_: unknown) => undefined,
    setAvailableTenants: (_: unknown) => undefined,
    switchTenant: async (_id: string, _api: unknown) => undefined,
    setSwitcherOpen: (_: unknown) => undefined,
    setLoading: (_: unknown) => undefined,
    setError: (_: unknown) => undefined,
    reset: () => undefined,
  };
}

/**
 * Returns true if the user can switch to a given tenant slug.
 */
export function useCanSwitchToTenant(tenantId: string): boolean {
  const { currentTenant, availableTenants } = useSessionTenants();
  if (currentTenant?.id === tenantId) return false;
  return availableTenants.some((t) => t.id === tenantId);
}
