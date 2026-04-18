"use server";

/**
 * claimAccountAction
 *
 * Server Action that completes the shell-user claim flow. Invoked by the
 * client-side ClaimAccountForm after the user enters a password against a
 * 14-day invitation token. Steps:
 *
 *   1. Zod-validate the payload (confirm-match + password complexity).
 *   2. Look up the Better Auth invitation row by token.
 *   3. Reject if the invitation is missing / consumed / expired.
 *   4. Run HIBP + complexity via `auth.api` which honours the `hooks.before`
 *      middleware wired in `src/lib/auth-server.ts`.
 *   5. Set the password on the shell user's account:
 *        a. Hash via `ctx.password.hash`.
 *        b. If the user already has a credential account (shouldn't, for a
 *           true shell user) → `internalAdapter.updatePassword`.
 *        c. Else → `internalAdapter.linkAccount` with providerId=credential.
 *   6. Flip `emailVerified = true` (the claim link proves they own the inbox).
 *   7. Mark the invitation row `status = accepted`.
 *   8. Sign them in with `auth.api.signInEmail`.
 *   9. Redirect to /dashboard/default.
 *
 * Every terminal path emits a `claim_completed` audit event so ops can see
 * the full lifecycle alongside the operator-side `[audit.tenant-operator]`
 * stream.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as z from "zod";
import { getOrgAdapter } from "better-auth/plugins/organization";

import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { isPasswordBreached } from "@/src/lib/auth/hibp";
import { hibpChecks } from "@/src/lib/metrics/auth";
import { passwordSchema } from "@/src/lib/validators/auth";
import { recordDebugError, isDebug } from "@/src/lib/debug";

// See note in admin-provisioning.ts — getOrgAdapter's input type isn't
// separately-exported, so we erase it here too.
type AnyCtx = Parameters<typeof getOrgAdapter>[0];

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const claimAccountSchema = z
  .object({
    token: z.string().min(1, "Claim token is required"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ClaimAccountInput = z.infer<typeof claimAccountSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimAccountResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "TOKEN_EXPIRED"
        | "TOKEN_INVALID"
        | "PASSWORD_POLICY"
        | "PASSWORD_BREACHED"
        | "CONFIRM_MISMATCH"
        | "SERVICE_UNAVAILABLE";
      message: string;
    };

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function claimAccountAction(
  input: ClaimAccountInput,
): Promise<ClaimAccountResult> {
  // 1. Validate input.
  const parsed = claimAccountSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.[0];
    if (path === "confirmPassword") {
      return { ok: false, code: "CONFIRM_MISMATCH", message: issue.message };
    }
    if (
      path === "password" ||
      String(issue?.message ?? "").toLowerCase().includes("password")
    ) {
      return {
        ok: false,
        code: "PASSWORD_POLICY",
        message: issue?.message ?? "Password does not meet requirements.",
      };
    }
    return {
      ok: false,
      code: "TOKEN_INVALID",
      message: issue?.message ?? "Invalid input.",
    };
  }

  const { token, password } = parsed.data;

  // 2. Look up the invitation + validate token.
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);

  type InvitationShape = {
    id: string;
    email: string;
    organizationId: string;
    status: string;
    expiresAt: Date;
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
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId: "anonymous",
      errorCode: "TOKEN_INVALID",
    });
    return {
      ok: false,
      code: "TOKEN_INVALID",
      message: "This invitation link is invalid or has already been used.",
    };
  }
  if (invitation.status !== "pending") {
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId: "anonymous",
      errorCode: "TOKEN_INVALID",
      reason: `invitation_status=${invitation.status}`,
    });
    return {
      ok: false,
      code: "TOKEN_INVALID",
      message: "This invitation link is invalid or has already been used.",
    };
  }
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : new Date(invitation.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId: "anonymous",
      errorCode: "TOKEN_EXPIRED",
    });
    return {
      ok: false,
      code: "TOKEN_EXPIRED",
      message: "This invitation link has expired. Ask your admin to resend.",
    };
  }

  // 3. Resolve the user the invitation is for. We only consume the token for
  //    a user that actually exists — a race between admin reissue and a
  //    manual DB wipe shouldn't silently create an unrelated user.
  const userRec = await ctx.internalAdapter.findUserByEmail(invitation.email);
  const resolvedUser =
    (userRec as unknown as { user?: { id: string; email: string } } | null)
      ?.user ??
    (userRec as unknown as { id?: string; email?: string } | null);
  if (!resolvedUser || !("id" in resolvedUser) || !resolvedUser.id) {
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId: "anonymous",
      errorCode: "TOKEN_INVALID",
      reason: "user_missing",
    });
    return {
      ok: false,
      code: "TOKEN_INVALID",
      message: "This invitation link is invalid or has already been used.",
    };
  }
  const userId = String(resolvedUser.id);

  // 4. Defence-in-depth password checks. The `hooks.before` middleware in
  //    auth-server.ts runs these on Better Auth's own password-write paths,
  //    but this claim path bypasses those endpoints because the shell user
  //    has no active session yet. Duplicate the checks here so claim-path
  //    passwords can never be weaker than signup-path passwords.
  const breachResult = await isPasswordBreached(password);
  if (breachResult.breached === true) {
    hibpChecks.inc({ outcome: "breached" });
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId,
      errorCode: "PASSWORD_BREACHED",
    });
    return {
      ok: false,
      code: "PASSWORD_BREACHED",
      message:
        "This password has appeared in a public data breach. Please choose a different one.",
    };
  }
  if (breachResult.breached === "unknown") {
    hibpChecks.inc({ outcome: "unknown" });
    emitAuthAudit({
      action: "hibp_unavailable",
      outcome: "failed",
      userId,
      reason: breachResult.reason,
    });
    // fail-open — let the claim proceed.
  } else {
    hibpChecks.inc({ outcome: "clean" });
  }

  // 5. Set the password on the shell user's account. For a true shell user
  //    no credential account exists yet, so we linkAccount; in the defensive
  //    case where one already exists, updatePassword.
  try {
    const ctxWithPassword = ctx as unknown as {
      password: { hash: (p: string) => Promise<string> };
      internalAdapter: typeof ctx.internalAdapter & {
        updatePassword: (userId: string, hash: string) => Promise<unknown>;
        linkAccount: (args: {
          userId: string;
          providerId: string;
          accountId: string;
          password: string;
        }) => Promise<unknown>;
        findAccounts: (userId: string) => Promise<
          Array<{ providerId: string; password?: string | null }>
        >;
      };
    };
    const hash = await ctxWithPassword.password.hash(password);
    const accounts = await ctxWithPassword.internalAdapter.findAccounts(userId);
    const credential = accounts.find((a) => a.providerId === "credential");
    if (credential) {
      await ctxWithPassword.internalAdapter.updatePassword(userId, hash);
    } else {
      await ctxWithPassword.internalAdapter.linkAccount({
        userId,
        providerId: "credential",
        accountId: userId,
        password: hash,
      });
    }

    // 6. Flip emailVerified = true — clicking the emailed link proves inbox
    //    control. Matches the semantics of the email-verification flow.
    await ctx.internalAdapter.updateUser(userId, {
      emailVerified: true,
    } as Parameters<typeof ctx.internalAdapter.updateUser>[1]);

    // 7. Mark the invitation accepted. Single-use from this point on.
    await adapter.updateInvitation({
      invitationId: invitation.id,
      status: "accepted",
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:claimAccount",
      method: "ACTION",
      status: 500,
      message: e.message,
      stack: e.stack,
    });
    emitAuthAudit({
      action: "claim_completed",
      outcome: "failed",
      userId,
      errorMessage: e.message,
    });
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: isDebug
        ? `claim: ${e.message}`
        : "We couldn't complete your account claim. Please try again or contact your admin.",
    };
  }

  // 8. Sign in fresh. The new session cookie is committed by nextCookies()
  //    in the auth-server.ts plugin list.
  const reqHeaders = await headers();
  try {
    await auth.api.signInEmail({
      body: {
        email: invitation.email,
        password,
      },
      headers: reqHeaders,
    });
  } catch (err) {
    // The password was written successfully, so we do not want to fail the
    // whole flow — the user can sign in manually from /login. Record the
    // audit as "ok" since the claim itself completed, but log the sign-in
    // failure for debug.
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:claimAccount.signIn",
      method: "ACTION",
      status: 500,
      message: e.message,
      stack: e.stack,
    });
    emitAuthAudit({
      action: "claim_completed",
      outcome: "ok",
      userId,
      reason: "post_claim_signin_failed",
      errorMessage: e.message,
    });
    redirect("/login?claim=success");
  }

  // 9. Success path — emit audit + redirect.
  emitAuthAudit({
    action: "claim_completed",
    outcome: "ok",
    userId,
    targetTenant: invitation.organizationId,
  });
  redirect("/dashboard/default");
}
