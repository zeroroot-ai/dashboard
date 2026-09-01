/**
 * What the dashboard can know about a caller's rights on one bank
 * (gibson#1706 lane E1, hook split rule).
 *
 * The FGA model (gibson `model.fga`, type bank) says:
 *   owner    = [user] or admin from tenant_owned
 *   can_send = [direct grants] or owner
 *   can_read = [direct grants] or can_send or owner
 *
 * The dashboard sees the bank's owner and the caller's tenant role, so it can
 * derive `owner`. It cannot see a direct grant, so `canSend` here is the
 * lower bound: true when the caller owns the bank, false when the dashboard
 * does not know. The daemon is the authority on every call
 * (`assertAuthorized` forwards per-object RPCs, dashboard#1176), so a caller
 * with a direct grant still succeeds; the UI only hides the controls it
 * cannot vouch for.
 *
 * `useAuthorize` cannot answer any of this: the bank RPCs are object-scoped
 * and it returns `object-scoped` for them by design.
 */

import type { PrincipalView } from "./view";

/** Tenant roles the FGA model treats as `admin` on the tenant. */
const TENANT_ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "owner"]);

export interface BankPermissions {
  /** `owner` on the bank: edit count and policies, delete, drive sign-in. */
  canManage: boolean;
  /** `can_send` as far as the dashboard can tell (owner implies it). */
  canSend: boolean;
}

interface Caller {
  userId: string | null;
  /** The caller's role on the active tenant, or null. */
  tenantRole: string | null;
}

export function deriveBankPermissions(owner: PrincipalView, me: Caller): BankPermissions {
  const isOwner =
    (owner.kind === "user" && me.userId !== null && owner.id === me.userId) ||
    (owner.kind === "tenant" && me.tenantRole !== null && TENANT_ADMIN_ROLES.has(me.tenantRole));
  return { canManage: isOwner, canSend: isOwner };
}
