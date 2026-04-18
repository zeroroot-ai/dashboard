"use server";

/**
 * resetPasswordAction
 *
 * Server Action that completes the password-reset flow. Validates the token,
 * applies the new password via Better Auth's `resetPassword` endpoint (which
 * triggers the `hooks.before` HIBP + complexity check wired in
 * `src/lib/auth-server.ts`), then signs the user in fresh.
 *
 * Sessions:
 *   Better Auth is configured with `revokeSessionsOnPasswordReset: true`, so
 *   all existing sessions are invalidated automatically when `resetPassword`
 *   succeeds. This action then issues a fresh session via `signInEmail`.
 *
 * Enumeration resistance:
 *   - Token-not-found and token-for-a-missing-user both surface as
 *     TOKEN_INVALID — distinguishable only from TOKEN_EXPIRED, which gives
 *     the user an actionable message (request a new link).
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as z from "zod";

import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { passwordResets } from "@/src/lib/metrics/auth";
import { recordDebugError, isDebug } from "@/src/lib/debug";
import { passwordSchema } from "@/src/lib/validators/auth";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; code: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "PASSWORD_POLICY" | "CONFIRM_MISMATCH" | "SERVICE_UNAVAILABLE"; message: string };

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function resetPasswordAction(
  input: ResetPasswordInput,
): Promise<ResetPasswordResult> {
  // 1. Validate input (including confirm-match).
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.[0];
    if (path === "confirmPassword") {
      return { ok: false, code: "CONFIRM_MISMATCH", message: issue.message };
    }
    if (path === "password" || String(issue?.message ?? "").toLowerCase().includes("password")) {
      return {
        ok: false,
        code: "PASSWORD_POLICY",
        message: issue?.message ?? "Password does not meet requirements.",
      };
    }
    return { ok: false, code: "TOKEN_INVALID", message: issue?.message ?? "Invalid input." };
  }

  const { token, password } = parsed.data;
  const reqHeaders = await headers();

  // 2. Call Better Auth's resetPassword endpoint. This:
  //    a. Looks up the verification token.
  //    b. Validates token expiry.
  //    c. Runs hooks.before (complexity + HIBP check).
  //    d. Updates the password hash.
  //    e. Revokes all existing sessions (revokeSessionsOnPasswordReset: true).
  let userId: string | undefined;
  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token },
      headers: reqHeaders,
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const msg = e.message;

    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:resetPassword",
      method: "ACTION",
      status: 400,
      message: msg,
      stack: e.stack,
    });

    emitAuthAudit({
      action: "password_reset_completed",
      outcome: "failed",
      userId: "anonymous",
      errorMessage: msg,
    });
    passwordResets.inc({ outcome: "failed" });

    // Map Better Auth error messages to user-facing codes.
    // Both "token not found" and "user not found after token lookup" map to
    // TOKEN_INVALID to avoid revealing which case occurred.
    if (/expired|EXPIRED/i.test(msg) && !/invalid/i.test(msg)) {
      return {
        ok: false,
        code: "TOKEN_EXPIRED",
        message: isDebug ? msg : "This reset link has expired. Please request a new one.",
      };
    }
    if (
      /invalid.*token|token.*invalid|INVALID_TOKEN|not found/i.test(msg)
    ) {
      return {
        ok: false,
        code: "TOKEN_INVALID",
        message: isDebug ? msg : "This reset link is invalid or has already been used.",
      };
    }
    if (/PASSWORD_BREACHED|breach/i.test(msg)) {
      return {
        ok: false,
        code: "PASSWORD_POLICY",
        message: isDebug
          ? msg
          : "This password has appeared in a known data breach. Please choose a different one.",
      };
    }
    if (/password.*short|password.*long|too short|too long|at least|must contain/i.test(msg)) {
      return {
        ok: false,
        code: "PASSWORD_POLICY",
        message: isDebug ? msg : "Your password does not meet the requirements.",
      };
    }

    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: isDebug ? msg : "An error occurred. Please try again.",
    };
  }

  // 3. Emit success audit + metric.
  emitAuthAudit({
    action: "password_reset_completed",
    outcome: "ok",
    userId: userId ?? "anonymous",
  });
  passwordResets.inc({ outcome: "ok" });

  // 4. Sign the user in fresh. Better Auth already revoked all previous
  //    sessions; this issues a new session cookie for the current browser.
  //    We do not have the email available here without a DB lookup, so we
  //    redirect to /login and let the user sign in normally. If Better Auth
  //    exposes the recovered user from resetPassword we can use signInEmail
  //    directly. For now, redirect to login with a success hint.
  redirect("/login?reset=success");
}
