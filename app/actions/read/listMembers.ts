"use server";

/**
 * listMembersAction — read-side Server Action for the Members settings page
 * and the MemberPicker combobox in Model Access.
 *
 * Calls TenantAdminService.ListMembers (platform-sdk PR #34) to enumerate
 * the current tenant's members with human-readable names and emails.
 *
 * Graceful fallback: Unimplemented and Unavailable are treated as an empty
 * member list so the dashboard renders cleanly before the daemon ships the
 * handler. Any other RPC error is surfaced as { ok: false }.
 *
 * Spec: dashboard#340 Module D (MemberPicker) + Module E (Members page).
 */

import { ConnectError, Code } from "@connectrpc/connect";
import {
  MembershipService,
  type TenantMember,
} from "@/src/gen/gibson/tenant/v1/membership_pb";
import { userClient } from "@/src/lib/gibson-client";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { auth } from "@/auth";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Dashboard-safe shape for a single tenant member. */
export interface MemberRow {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  /** ISO 8601 string, or empty string when the field is unset. */
  joinedAt: string;
  /** "active" for joined members, "invited" for pending invitations. */
  status: string;
}

function toMemberRow(m: TenantMember): MemberRow {
  let joinedAt = "";
  if (m.joinedAt) {
    const ms = Number(m.joinedAt.seconds) * 1000 + Math.floor(m.joinedAt.nanos / 1_000_000);
    joinedAt = new Date(ms).toISOString();
  }
  return {
    userId: m.userId,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
    joinedAt,
    status: m.status || "active",
  };
}

/**
 * Fetch up to 500 members of the active tenant.
 *
 * Returns { ok: true, data: [] } when the daemon returns Unimplemented or
 * Unavailable — the caller degrades gracefully until the handler ships.
 */
export async function listMembersAction(
  nameFilter?: string,
): Promise<ActionResult<MemberRow[]>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant" };
  }

  try {
    const client = userClient(MembershipService);
    const resp = await client.listMembers({
      tenantId,
      pageToken: "",
      pageSize: 500,
      nameFilter: nameFilter ?? "",
    });
    return { ok: true, data: (resp.members ?? []).map(toMemberRow) };
  } catch (err) {
    if (err instanceof ConnectError) {
      if (err.code === Code.Unimplemented || err.code === Code.Unavailable) {
        // Backend handler not yet deployed — degrade gracefully.
        return { ok: true, data: [] };
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
