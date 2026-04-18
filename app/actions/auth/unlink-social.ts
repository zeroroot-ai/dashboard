"use server";

/**
 * unlinkSocialAction
 *
 * Server Action that removes a social provider linkage from the currently
 * signed-in user's account.
 *
 * Last-credential guard (Requirement 5.4):
 *   Before unlinking, the action counts the user's total sign-in methods
 *   (email+password = 1 if present, plus 1 per linked social provider).
 *   If the count is 1 AND the target is that sole method, the action refuses
 *   with LAST_CREDENTIAL to prevent account lockout. This is load-bearing
 *   security — do not remove or weaken the guard.
 *
 * Flow:
 *   1. Require an active session.
 *   2. Validate the provider name.
 *   3. List the user's accounts and check the target is linked.
 *   4. Apply the last-credential guard.
 *   5. Call auth.api.unlinkAccount.
 *   6. Emit audit event.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { getSession } from "@/app/actions/auth/session";
import { type ProviderId } from "@/src/lib/social-providers";
import { countSignInMethods } from "@/src/lib/auth/count-signin-methods";
import { checkRateLimit, getClientIP } from "@/src/lib/rate-limiter";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { recordDebugError } from "@/src/lib/debug";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnlinkSocialResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "UNAUTHENTICATED"
        | "INVALID_PROVIDER"
        | "NOT_LINKED"
        | "LAST_CREDENTIAL"
        | "RATE_LIMITED"
        | "PROVIDER_ERROR";
      message: string;
    };

export interface UnlinkSocialInput {
  provider: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNLINK_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many unlink attempts. Please try again in a minute.",
};

const ALL_PROVIDER_IDS = new Set<ProviderId>([
  "github",
  "gitlab",
  "google",
  "microsoft",
]);

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function unlinkSocialAction(
  input: UnlinkSocialInput
): Promise<UnlinkSocialResult> {
  // ── Require session ───────────────────────────────────────────────────────
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "You must be signed in to unlink a provider.",
    };
  }

  const userId = session.user.id;

  // ── Validate provider ─────────────────────────────────────────────────────
  const providerRaw = (input.provider ?? "").trim().toLowerCase();
  if (!ALL_PROVIDER_IDS.has(providerRaw as ProviderId)) {
    return {
      ok: false,
      code: "INVALID_PROVIDER",
      message: `Unknown provider: "${providerRaw}".`,
    };
  }
  const provider = providerRaw as ProviderId;

  // ── Rate limit ────────────────────────────────────────────────────────────
  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const remoteIp = getClientIP(fakeReq);

  const rl = await checkRateLimit(fakeReq, "auth:unlink-social", UNLINK_RATE_LIMIT);
  if (!rl.allowed) {
    emitAuthAudit({
      action: "unlink_social",
      outcome: "rate_limited",
      userId,
      reason: "rate_limited",
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: UNLINK_RATE_LIMIT.message,
    };
  }

  // ── Fetch user accounts ───────────────────────────────────────────────────
  let accounts: Array<{ providerId: string; accountId?: string }>;
  try {
    const result = await auth.api.listUserAccounts({ headers: reqHeaders });
    accounts = Array.isArray(result) ? result : [];
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:unlinkSocial:listAccounts",
      method: "ACTION",
      status: 500,
      message: e.message,
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "Unable to retrieve linked accounts. Please try again.",
    };
  }

  // ── Check target provider is actually linked ──────────────────────────────
  const targetAccount = accounts.find((a) => a.providerId === provider);
  if (!targetAccount) {
    return {
      ok: false,
      code: "NOT_LINKED",
      message: `The "${provider}" provider is not linked to your account.`,
    };
  }

  // ── Last-credential guard ─────────────────────────────────────────────────
  // LOAD-BEARING: this prevents account lockout. Do not remove or weaken.
  // countSignInMethods counts unique provider IDs — "credential" = password,
  // social provider IDs = their respective counts.
  const methodCount = countSignInMethods(accounts);
  if (methodCount <= 1) {
    emitAuthAudit({
      action: "unlink_social",
      outcome: "failed",
      userId,
      reason: "last_credential",
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "LAST_CREDENTIAL",
      message:
        "You must keep at least one sign-in method. Add a password or link another provider before removing this one.",
    };
  }

  // ── Unlink ────────────────────────────────────────────────────────────────
  try {
    await auth.api.unlinkAccount({
      body: {
        providerId: provider,
        accountId: targetAccount.accountId,
      },
      headers: reqHeaders,
    });

    emitAuthAudit({
      action: "unlink_social",
      outcome: "ok",
      userId,
      reason: provider,
      ip: remoteIp,
    });

    return { ok: true };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:unlinkSocial",
      method: "ACTION",
      status: 500,
      message: e.message,
    });
    emitAuthAudit({
      action: "unlink_social",
      outcome: "failed",
      userId,
      reason: provider,
      errorMessage: e.message,
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "Unable to unlink provider. Please try again.",
    };
  }
}
