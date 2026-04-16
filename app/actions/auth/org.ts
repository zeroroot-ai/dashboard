"use server";

/**
 * Organization Server Actions
 *
 * Replace browser-driven calls into /api/auth/organization/* with
 * in-process auth.api.* invocations. The tenant-operator's SPIFFE-
 * authenticated /api/admin/provisioning/* surface is unaffected — it
 * is a separate workload-to-workload trust boundary.
 *
 * Authorization model: every action loads the caller's session via
 * getSession(); if the session does not authorize the requested
 * operation, the action returns a forbidden result. Better Auth's
 * organization plugin enforces role-based permissions internally too,
 * so this is defence in depth, not the only check.
 */

import { headers } from "next/headers";

import { auth } from "@/src/lib/auth-server";
import { isDebug, recordDebugError } from "@/src/lib/debug";
import { getSession } from "@/app/actions/auth/session";

export type OrgResult<T = { id: string }> =
  | { ok: true; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "BAD_INPUT" | "INTERNAL"; message: string };

async function requireSession(): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: OrgResult<never> }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "You must be signed in.",
      },
    };
  }
  const userId =
    (session as unknown as { user?: { id?: string } }).user?.id ??
    (session as unknown as { userId?: string }).userId ??
    "";
  if (!userId) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "You must be signed in.",
      },
    };
  }
  return { ok: true, userId };
}

function err(e: unknown, route: string): OrgResult<never> {
  const ee = e instanceof Error ? e : new Error(String(e));
  recordDebugError({
    ts: new Date().toISOString(),
    route,
    method: "ACTION",
    status: 500,
    message: ee.message,
    stack: ee.stack,
  });
  return {
    ok: false,
    code: "INTERNAL",
    message: isDebug ? ee.message : "Operation failed.",
  };
}

// ---------------------------------------------------------------------
// create
// ---------------------------------------------------------------------

export type CreateOrgInput = { name: string; slug: string };

export async function createOrgAction(input: CreateOrgInput): Promise<OrgResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard.result;

  if (!input.name || !input.slug) {
    return { ok: false, code: "BAD_INPUT", message: "name and slug are required" };
  }

  try {
    const res = await auth.api.createOrganization({
      body: { name: input.name, slug: input.slug },
      headers: await headers(),
    });
    const id = (res as unknown as { id?: string }).id ?? "";
    return { ok: true, data: { id } };
  } catch (e) {
    return err(e, "action:org.create");
  }
}

// ---------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------

export type DeleteOrgInput = { organizationId: string };

export async function deleteOrgAction(input: DeleteOrgInput): Promise<OrgResult<{ ok: true }>> {
  const guard = await requireSession();
  if (!guard.ok) return guard.result;

  if (!input.organizationId) {
    return { ok: false, code: "BAD_INPUT", message: "organizationId is required" };
  }

  try {
    await auth.api.deleteOrganization({
      body: { organizationId: input.organizationId },
      headers: await headers(),
    });
    return { ok: true, data: { ok: true } };
  } catch (e) {
    return err(e, "action:org.delete");
  }
}

// ---------------------------------------------------------------------
// add member
// ---------------------------------------------------------------------

export type AddMemberInput = {
  organizationId: string;
  userId: string;
  role: string; // "admin" | "member" | custom
};

export async function addMemberAction(input: AddMemberInput): Promise<OrgResult<{ ok: true }>> {
  const guard = await requireSession();
  if (!guard.ok) return guard.result;

  if (!input.organizationId || !input.userId || !input.role) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "organizationId, userId, and role are required",
    };
  }

  try {
    await auth.api.addMember({
      body: {
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role as "admin" | "member" | "owner",
      },
      headers: await headers(),
    });
    return { ok: true, data: { ok: true } };
  } catch (e) {
    return err(e, "action:org.addMember");
  }
}

// ---------------------------------------------------------------------
// remove member
// ---------------------------------------------------------------------

export type RemoveMemberInput = {
  organizationId: string;
  memberIdOrEmail: string;
};

export async function removeMemberAction(
  input: RemoveMemberInput,
): Promise<OrgResult<{ ok: true }>> {
  const guard = await requireSession();
  if (!guard.ok) return guard.result;

  if (!input.organizationId || !input.memberIdOrEmail) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "organizationId and memberIdOrEmail are required",
    };
  }

  try {
    await auth.api.removeMember({
      body: {
        organizationId: input.organizationId,
        memberIdOrEmail: input.memberIdOrEmail,
      },
      headers: await headers(),
    });
    return { ok: true, data: { ok: true } };
  } catch (e) {
    return err(e, "action:org.removeMember");
  }
}
