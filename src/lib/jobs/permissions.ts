/**
 * What the dashboard can know about a caller's rights on one job
 * (gibson#1706 lane E3, hook split rule).
 *
 * The FGA model (gibson `model.fga`, type job):
 *   can_send  = opened_by or can_send from parent (the bank)
 *   can_close = scorer or opened_by or owner from parent
 *
 * The dashboard sees who opened the job and what it knows of the bank
 * (`deriveBankPermissions`). A `scorer` grant or a direct bank grant is
 * invisible here, so both flags are a lower bound: the daemon decides on
 * every call and the UI hides only what it cannot vouch for.
 */

import type { BankPermissions } from "@/src/lib/banks/permissions";
import type { PrincipalView } from "@/src/lib/banks/view";

interface JobPermissions {
  canSend: boolean;
  canClose: boolean;
}

export function deriveJobPermissions(
  openedBy: PrincipalView,
  bank: BankPermissions,
  myUserId: string | null,
): JobPermissions {
  const opener = openedBy.kind === "user" && myUserId !== null && openedBy.id === myUserId;
  return {
    canSend: opener || bank.canSend,
    canClose: opener || bank.canManage,
  };
}
