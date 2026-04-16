'use client';

import { useSession } from '@/src/lib/session-client';
import { signOutAction } from '@/app/actions/auth/signout';

/**
 * Client-side hooks for accessing tenant + permission information from
 * the session.
 *
 * These hooks are designed for use in Client Components where you need
 * to gate UI on the current user's tenant or permissions.
 *
 * Permission resolution is fully driven by the daemon's permissions.yaml
 * schema (declarative-rbac-framework spec). The set of effective
 * permissions is computed once during sign-in (via the server-side
 * getServerSession enrichment) and stored on session.user.permissions,
 * so these hooks read that flat array directly — no client-side role
 * mapping, no hardcoded role names anywhere on the wire.
 *
 * For Server Components, use hasPermission() / isCrossTenant() from
 * '@/src/lib/auth/schema' instead.
 */

/** Extended session user type with Gibson-specific fields. */
interface GibsonSessionUser {
  tenantId?: string;
  tenants?: string[];
  groups?: string[];
  permissions?: string[];
  crossTenant?: boolean;
}

type BetterAuthSessionData = ReturnType<typeof useSession>['data'];

function getGibsonUser(session: BetterAuthSessionData): GibsonSessionUser {
  // Better Auth sessions carry the raw user shape. Gibson-specific fields
  // (tenants, permissions, crossTenant, etc.) are server-populated and
  // available via the cookie-cached enriched session. The client-side
  // session from useSession() contains only the core Better Auth
  // fields; Gibson fields are read from session.user using type casting
  // since Better Auth's client types do not model these custom fields.
  return (session?.user ?? {}) as unknown as GibsonSessionUser;
}

/**
 * Hook to get the current tenant ID from the session.
 */
export function useTenantId(): string | null {
  const { data: session } = useSession();
  return getGibsonUser(session).tenantId ?? null;
}

/**
 * Hook to get all available tenants for the current user.
 */
export function useAvailableTenants(): string[] {
  const { data: session } = useSession();
  return getGibsonUser(session).tenants ?? [];
}

/**
 * Hook to check if the current user has multiple tenants.
 */
export function useHasMultipleTenants(): boolean {
  const tenants = useAvailableTenants();
  return tenants.length > 1;
}

/**
 * Hook to check whether the current user is permitted to perform a
 * specific action by holding the given permission.
 *
 * Permission strings are the canonical "resource:action" form declared
 * in core/gibson/internal/auth/permissions.yaml. Reads from
 * session.user.permissions which the server-side getServerSession resolved
 * against the daemon's live schema at sign-in time.
 *
 * @example
 *   const canExecute = usePermitted('missions:execute');
 *   if (!canExecute) return null;
 */
export function usePermitted(permission: string): boolean {
  const { data: session } = useSession();
  return getGibsonUser(session).permissions?.includes(permission) ?? false;
}

/**
 * Hook returning true when the user holds at least one role flagged
 * cross_tenant=true in the daemon schema (platform-operator, provisioner,
 * *-executor). Use for UI that operates across tenant boundaries.
 */
export function useIsCrossTenant(): boolean {
  const { data: session } = useSession();
  return getGibsonUser(session).crossTenant ?? false;
}

/**
 * Hook to get the current user's groups from the identity provider.
 */
export function useGroups(): string[] {
  const { data: session } = useSession();
  return getGibsonUser(session).groups ?? [];
}
