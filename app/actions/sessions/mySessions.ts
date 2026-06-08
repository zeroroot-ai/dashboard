"use server";

/**
 * Self-service login-session actions for the Settings → CLI page
 * (PRD dashboard#738, slices S3/S4).
 *
 * Both actions act ONLY on the authenticated caller's own sessions — the
 * daemon's gibson.session.v1.SessionService is self-scoped and the dashboard
 * never passes a user id. listMySessionsAction additionally decodes the
 * caller's own session id (the `sid` claim on the Zitadel access token) so the
 * UI can mark "this device". That match is best-effort: if the IdP's OIDC
 * `sid` does not line up with the Session API id, no row is flagged and the
 * feature still works (revoke is by row id, with a confirm step).
 */

import { decodeJwt } from "jose";

import { SessionService } from "@/src/gen/gibson/session/v1/session_pb";
import { auth } from "@/auth";
import { userClient, timestampToISO } from "@/src/lib/gibson-client";

export interface MySession {
  id: string;
  ip: string;
  browser: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  /** True for the session this browser/CLI is currently using ("this device"). */
  isCurrent: boolean;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** currentSidFromAccessToken returns the caller's own session id, or "". */
function currentSidFromAccessToken(accessToken: unknown): string {
  if (typeof accessToken !== "string" || accessToken === "") return "";
  try {
    const claims = decodeJwt(accessToken);
    return typeof claims.sid === "string" ? claims.sid : "";
  } catch {
    return "";
  }
}

export async function listMySessionsAction(): Promise<ActionResult<MySession[]>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }
  const currentSid = currentSidFromAccessToken(session.accessToken);

  try {
    const resp = await userClient(SessionService).listMySessions({});
    const data: MySession[] = resp.sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      browser: s.browser,
      createdAt: timestampToISO(s.createdAt),
      lastActiveAt: timestampToISO(s.lastActiveAt),
      isCurrent: currentSid !== "" && s.id === currentSid,
    }));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function revokeMySessionAction(
  sessionId: string,
): Promise<ActionResult<null>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }
  if (!sessionId) {
    return { ok: false, error: "session_id is required" };
  }

  try {
    await userClient(SessionService).revokeMySession({ sessionId });
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
