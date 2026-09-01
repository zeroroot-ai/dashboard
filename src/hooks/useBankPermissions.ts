'use client';

/**
 * The caller's rights on one bank, from object data (gibson#1706 lane E1).
 *
 * Hook split rule: `useAuthorize` decides tenant-scoped RPCs from the
 * membership role and returns `object-scoped` for every bank RPC, so it
 * cannot gate this chrome. This hook reads the bank's owner, the session
 * user id and the caller's role on the active tenant, and derives `owner`
 * the way the FGA model does. See `src/lib/banks/permissions.ts`.
 */

import { useSession } from '@/src/lib/session-client';
import { useTenantContext } from '@/src/lib/tenant-context';
import { deriveBankPermissions, type BankPermissions } from '@/src/lib/banks/permissions';
import type { PrincipalView } from '@/src/lib/banks/view';

/** The caller's role on the active tenant, or null before one is chosen. */
export function useActiveTenantRole(): string | null {
  const { currentTenant, rolesByTenant } = useTenantContext();
  return currentTenant ? (rolesByTenant[currentTenant.id] ?? null) : null;
}

const NONE: BankPermissions = { canManage: false, canSend: false };

export function useBankPermissions(owner: PrincipalView | undefined): BankPermissions {
  const { data: session } = useSession();
  const tenantRole = useActiveTenantRole();
  if (!owner) return NONE;
  return deriveBankPermissions(owner, { userId: session?.user.id ?? null, tenantRole });
}
