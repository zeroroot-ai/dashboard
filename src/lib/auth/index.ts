/**
 * Client-side auth hooks for use in Client Components.
 *
 * For server-side session access, use '@/src/lib/auth' instead.
 *
 * Authorization gating is driven by the generated AuthRegistry: gate UI on
 * the RPC the action invokes via `useAuthorize('/gibson...Method')`. The
 * registry maps each RPC to its FGA relation, which is checked against the
 * caller's role on the active tenant.
 *
 * @example
 * ```tsx
 * 'use client';
 *
 * import { useTenantId } from '@/src/lib/auth';
 * import { useAuthorize } from '@/src/lib/auth/use-authorize';
 *
 * export function MissionControls() {
 *   const tenantId = useTenantId();
 *   const { allowed, loading } = useAuthorize(
 *     '/gibson.daemon.v1.DaemonService/DispatchMission',
 *   );
 *
 *   if (loading || !allowed) return null;
 *
 *   return <button>Run Mission</button>;
 * }
 * ```
 */
export {
  useTenantId,
  useAvailableTenants,
  useHasMultipleTenants,
  useIsCrossTenant,
  useGroups,
} from './tenant';
