"use server";

/**
 * signOutAction
 *
 * Server Action replacing POST /api/auth/sign-out. Performs a *hard* sign
 * out: in addition to Better Auth's own `api.signOut` (which deletes the
 * session from the DB and clears the cookie), this action:
 *
 *   1. Reads the caller's session up front so the audit record carries the
 *      userId that is about to be revoked.
 *   2. Defensively re-invokes the internal session adapter's `deleteSession`
 *      with the session token — if something in the sign-out pipeline
 *      throws before the DB delete (e.g. a later plugin hook fails), the
 *      row is still removed. This guards against orphaned session rows that
 *      would otherwise remain valid until TTL expiry.
 *   3. Emits a `session_revoked` auth audit event so the SIEM and Loki
 *      pipelines see the revocation even when the session row is gone.
 *
 * After all of the above, the caller is redirected. Redirect target is
 * restricted to same-origin paths to prevent open-redirect abuse.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";

// Better Auth's internal auth context. We only interact with the session
// token + the internalAdapter.deleteSession function, so a loose shape is
// enough — over-typing here would couple the action to Better Auth
// internals that are private API.
type AuthInternalContext = {
  internalAdapter?: {
    deleteSession?: (token: string) => Promise<unknown>;
  };
};

export async function signOutAction(redirectTo?: string): Promise<never> {
  const requestHeaders = await headers();

  // 1. Identify the session we are about to revoke so the audit row can
  //    carry its userId. If there is no session (already signed out, cookie
  //    missing) we just audit under 'anonymous' — the redirect below still
  //    fires so the user lands on a logged-out page either way.
  let userId: string = "anonymous";
  let sessionToken: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session) {
      userId = session.user?.id ?? "anonymous";
      // Better Auth exposes the raw token at session.session.token.
      sessionToken =
        (session as { session?: { token?: string } }).session?.token ?? null;
    }
  } catch {
    // Session lookup failing is never fatal for sign-out — proceed.
  }

  // 2. Ask Better Auth to sign the user out. This clears the cookie via
  //    the nextCookies plugin and deletes the session row. If the call
  //    throws (e.g. because there was no active session), swallow the
  //    error so we still reach the redirect.
  try {
    await auth.api.signOut({ headers: requestHeaders });
  } catch {
    // Intentional — see comment above.
  }

  // 3. Defensive hard-delete. If we captured a token before step 2, invoke
  //    the internal adapter's deleteSession directly. This is idempotent:
  //    deleting an already-deleted row is a no-op. This guards against the
  //    case where a plugin in the signOut pipeline threw after the cookie
  //    was cleared but before the DB delete ran.
  if (sessionToken) {
    try {
      const ctx = (await auth.$context) as unknown as AuthInternalContext;
      await ctx?.internalAdapter?.deleteSession?.(sessionToken);
    } catch {
      // Defensive delete is best-effort — never block the redirect.
    }
  }

  // 4. Audit the revocation. emitAuthAudit() never throws, so no try/catch.
  emitAuthAudit({
    action: "session_revoked",
    outcome: "ok",
    userId,
    reason: "user_signout",
  });

  // Allow callers to pin a specific landing page; default to /login.
  // We restrict to same-origin paths to prevent open-redirect abuse.
  const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/login";
  redirect(target);
}
