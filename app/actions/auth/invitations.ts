"use server";

/**
 * listPendingInvitationsAction
 *
 * Returns the set of pending, non-expired organization invitations addressed
 * to the currently signed-in user's email. Uses Better Auth's org adapter
 * `listUserInvitations` which queries the `invitation` table filtered by
 * email, then joins the organization row for its name.
 *
 * Security invariant: the email used for filtering is always taken from the
 * server-side session — never from caller-supplied input — so one user can
 * never enumerate another user's invitations.
 */

import { getServerSession } from "@/src/lib/auth";
import { auth } from "@/src/lib/auth-server";
import { getOrgAdapter } from "better-auth/plugins/organization";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type PendingInvitation = {
  id: string;
  organizationId: string;
  organizationName?: string | null;
  role: string;
  expiresAt: string; // ISO 8601
  inviter?: { email: string; name?: string | null } | null;
};

export type ListPendingInvitationsResult =
  | { ok: true; invitations: PendingInvitation[] }
  | { ok: false; code: "UNAUTHENTICATED"; message: string };

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function listPendingInvitationsAction(): Promise<ListPendingInvitationsResult> {
  // Guard: must have a valid session.
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "You must be signed in to view your invitations.",
    };
  }

  const userEmail = session.user.email;
  const now = new Date();

  try {
    // Obtain the org adapter from the Better Auth context.
    // The adapter's listUserInvitations() queries the invitation table
    // WHERE email = :email (lowercased) and JOINs the organization row.
    type AnyCtx = Parameters<typeof getOrgAdapter>[0];
    const ctx = (await auth.$context) as unknown as AnyCtx;
    const orgAdapter = getOrgAdapter(ctx);

    const raw = await orgAdapter.listUserInvitations(userEmail);

    // Filter to pending, non-expired invitations only.
    // listUserInvitations returns all statuses; we are conservative here
    // and only show invitations the user can still act on.
    const pending: PendingInvitation[] = [];

    for (const inv of raw) {
      // Type-cast: the adapter returns a loose shape with optional fields.
      const invitation = inv as unknown as {
        id: string;
        organizationId: string;
        organizationName?: string | null;
        role: string;
        status: string;
        expiresAt: Date | string | null | undefined;
        inviterId?: string | null;
        inviter?: { email?: string | null; name?: string | null } | null;
      };

      if (invitation.status !== "pending") continue;

      // Guard against expired invitations. expiresAt may be a Date or an
      // ISO string depending on the DB driver / adapter version.
      if (invitation.expiresAt != null) {
        const expiresAt =
          invitation.expiresAt instanceof Date
            ? invitation.expiresAt
            : new Date(invitation.expiresAt);
        if (expiresAt <= now) continue;
      }

      pending.push({
        id: invitation.id,
        organizationId: invitation.organizationId,
        organizationName: invitation.organizationName ?? null,
        role: invitation.role,
        expiresAt:
          invitation.expiresAt instanceof Date
            ? invitation.expiresAt.toISOString()
            : String(invitation.expiresAt ?? ""),
        inviter: invitation.inviter
          ? {
              email: invitation.inviter.email ?? "",
              name: invitation.inviter.name ?? null,
            }
          : null,
      });
    }

    return { ok: true, invitations: pending };
  } catch (err) {
    // Do not leak internal error details. Return empty rather than failing the
    // entire no-workspace page — invitations are an optional affordance.
    console.error("[invitations] listPendingInvitationsAction failed:", err);
    return { ok: true, invitations: [] };
  }
}
