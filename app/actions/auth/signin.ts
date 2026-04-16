"use server";

/**
 * signInAction
 *
 * Server Action replacing POST /api/auth/sign-in/email. The browser
 * calls this directly via the Server Action RPC; there is no public
 * /api/auth/sign-in/email endpoint to curl.
 *
 * Anti-enumeration: any auth.api.signInEmail failure returns a single
 * generic message regardless of cause (unknown email vs bad password
 * vs banned account).
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { isDebug, recordDebugError } from "@/src/lib/debug";
import { checkRateLimit } from "@/src/lib/rate-limiter";
import { signinSchema, type SignInInput } from "@/src/lib/validators/auth";

const SIGNIN_RATE_LIMIT = {
  maxRequests: 20,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many sign-in attempts. Please try again in a minute.",
};

export type SignInResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

const GENERIC_AUTH_FAIL = "Invalid email or password.";

export async function signInAction(input: SignInInput): Promise<SignInResult> {
  const parsed = signinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: GENERIC_AUTH_FAIL };
  }

  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const rl = await checkRateLimit(fakeReq, "auth:signin", SIGNIN_RATE_LIMIT);
  if (!rl.allowed) {
    return { ok: false, message: SIGNIN_RATE_LIMIT.message };
  }

  try {
    await auth.api.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: reqHeaders,
    });
    return { ok: true, redirectTo: "/dashboard/default" };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    // Always log internally; only surface the underlying reason in
    // debug mode. The production-facing message is uniform.
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signIn",
      method: "ACTION",
      status: 401,
      message: e.message,
    });
    return {
      ok: false,
      message: isDebug ? `signInEmail: ${e.message}` : GENERIC_AUTH_FAIL,
    };
  }
}
