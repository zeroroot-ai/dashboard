/**
 * HMAC-signed nonce helpers for the "missing email" flow (GitHub private-email
 * case). Extracted from `app/actions/auth/provide-email.ts` because that file
 * carries `"use server"`, Turbopack rejects any sync export from a Server
 * Action module, and these helpers are called synchronously from both the
 * GitHub callback route handler and the Server Action.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const NONCE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface NoncePayload {
  userId: string;
  displayName: string;
  exp: number;
}

/**
 * Generate a 15-minute HMAC-signed nonce.
 */
export function generateProvideEmailNonce(
  userId: string,
  displayName: string,
): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("[provide-email] AUTH_SECRET (or legacy NEXTAUTH_SECRET) is required");

  const payload: NoncePayload = {
    userId,
    displayName,
    exp: Date.now() + NONCE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verify a nonce. Returns the payload or an error code.
 */
export function verifyProvideEmailNonce(
  token: string,
):
  | { ok: true; payload: NoncePayload }
  | { ok: false; code: "INVALID_TOKEN" | "TOKEN_EXPIRED" } {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return { ok: false, code: "INVALID_TOKEN" };

  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 0) return { ok: false, code: "INVALID_TOKEN" };

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = createHmac("sha256", secret).update(encoded).digest("base64url");

  try {
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: false, code: "INVALID_TOKEN" };
    }
  } catch {
    return { ok: false, code: "INVALID_TOKEN" };
  }

  let payload: NoncePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as NoncePayload;
  } catch {
    return { ok: false, code: "INVALID_TOKEN" };
  }

  if (!payload.userId || !payload.exp) return { ok: false, code: "INVALID_TOKEN" };
  if (Date.now() > payload.exp) return { ok: false, code: "TOKEN_EXPIRED" };

  return { ok: true, payload };
}
