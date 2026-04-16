/**
 * Client-side auth hooks for use in Client Components.
 *
 * For server-side session access, use '@/src/lib/auth' instead.
 *
 * Permission gating is fully driven by the daemon's permissions.yaml
 * schema. Permission strings are the canonical "resource:action" form —
 * never role names.
 *
 * @example
 * ```tsx
 * 'use client';
 *
 * import { useTenantId, usePermitted } from '@/src/lib/auth';
 *
 * export function MissionControls() {
 *   const tenantId = useTenantId();
 *   const canExecute = usePermitted('missions:execute');
 *
 *   if (!canExecute) return null;
 *
 *   return <button>Run Mission</button>;
 * }
 * ```
 */
export {
  useTenantId,
  useAvailableTenants,
  useHasMultipleTenants,
  usePermitted,
  useIsCrossTenant,
  useGroups,
} from './tenant';
