/**
 * Claim-account page — Server Component.
 *
 * Consumed by users whose accounts were shell-provisioned by the tenant
 * operator (`admin-provisioning.handleCreate` shell-user path) and who are
 * now completing their first sign-in via the 14-day claim token emailed at
 * that time.
 *
 * Flow:
 *   1. Read `token` from the query string (the invitation row's id).
 *   2. Look it up in the Better Auth invitation table via getOrgAdapter.
 *   3. Reject (TOKEN_EXPIRED / TOKEN_INVALID) before rendering the form so
 *      the user sees the actionable error immediately — no wasted typing.
 *   4. Render `ClaimAccountForm` with the token + masked email.
 *
 * Error UX mirrors the reset-password page: a card-shaped error with a
 * "Ask your admin to resend" CTA, wrapped in ErrorDisplay so assistive tech
 * announces the failure.
 */

import { getOrgAdapter } from "better-auth/plugins/organization";

import { auth } from "@/src/lib/auth-server";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";

import { ClaimAccountForm } from "./claim-account-form";

// See note in admin-provisioning.ts — erase the narrow plugin context type so
// getOrgAdapter accepts `auth.$context`.
type AnyCtx = Parameters<typeof getOrgAdapter>[0];

interface SearchParams {
  token?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

export default async function ClaimAccountPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = (params.token ?? "").trim();

  if (!token) {
    return renderTokenError("TOKEN_INVALID");
  }

  // Validate the token server-side against the Better Auth invitation row.
  // We do NOT mark the row as consumed here — that happens only after the
  // password is set in claimAccountAction, so a browser-refresh mid-flow is
  // still recoverable with the same link.
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);

  type InvitationShape = {
    id: string;
    email: string;
    organizationId: string;
    status: string;
    expiresAt: Date;
    role: string;
  };
  let invitation: InvitationShape | null = null;
  try {
    invitation = (await adapter.findInvitationById(
      token,
    )) as unknown as InvitationShape | null;
  } catch {
    invitation = null;
  }

  if (!invitation) {
    return renderTokenError("TOKEN_INVALID");
  }
  if (invitation.status !== "pending") {
    // Accepted, canceled, or rejected — either way the link is spent.
    return renderTokenError("TOKEN_INVALID");
  }
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : new Date(invitation.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return renderTokenError("TOKEN_EXPIRED");
  }

  // Fetch the org name for the "You're joining {org}" heading. Silent fallback
  // to an empty string if lookup fails — the form still works, we just render
  // a generic title.
  let orgName = "";
  try {
    const org = (await adapter.findOrganizationById(
      invitation.organizationId,
    )) as { name?: string } | null;
    orgName = org?.name ?? "";
  } catch {
    orgName = "";
  }

  return (
    <ClaimAccountForm
      token={token}
      email={invitation.email}
      orgName={orgName}
    />
  );
}

function renderTokenError(code: "TOKEN_EXPIRED" | "TOKEN_INVALID") {
  const error = resolveUserFacingError(code);
  // Override the default action so the CTA points users at their admin
  // rather than the generic /forgot-password route — this flow is
  // admin-driven, users cannot self-serve a reissue.
  const withAdminCta = {
    ...error,
    action: {
      label: "Ask your admin to resend",
      href: "mailto:?subject=Please%20resend%20my%20Gibson%20invitation",
    },
  };
  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <ErrorDisplay error={withAdminCta} className="mx-auto w-full max-w-md" />
    </div>
  );
}
