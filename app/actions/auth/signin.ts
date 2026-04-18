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
 *
 * Task 30 — Per-account lockout:
 *   In addition to the existing per-IP rate limit (20/min), invalid
 *   credentials also increment a per-account counter keyed by a
 *   SHA-256 hash of the normalized email. Threshold is 10 failures
 *   in a 10-minute window; exceeding it trips a 15-minute lockout.
 *   During the lockout window the action returns the same generic
 *   "invalid email or password" message (enumeration resistance) with
 *   a constant-time scrypt pad, and DOES NOT increment counters
 *   further. A one-shot notification email is dispatched on the
 *   transition into the locked state (throttled via an additional
 *   "email-sent" marker key so we never spam the account holder).
 *
 * Task 31 — CAPTCHA enforcement:
 *   After 5 IP failures in 5 minutes the action requires a CAPTCHA
 *   token on the next attempt. In disabled mode verifyCaptcha returns
 *   ok:true regardless and the check is a no-op.
 *
 * All rate-limit keys use SHA-256 of the normalized email — the raw
 * address never appears in Redis.
 */

import { createHash, randomBytes, scryptSync } from "node:crypto";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { isDebug, recordDebugError } from "@/src/lib/debug";
import { checkRateLimit, getClientIP } from "@/src/lib/rate-limiter";
import { signinSchema, type SignInInput } from "@/src/lib/validators/auth";
import { verifyCaptcha } from "@/src/lib/auth/captcha";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { getCorrelationId } from "@/src/lib/correlation";
import {
  signinAttempts,
  accountLockouts,
  captchaFailures,
} from "@/src/lib/metrics/auth";
import { getEmailProvider } from "@/src/lib/email/provider";
import { render as renderAccountLockedEmail } from "@/src/lib/email/templates/account-locked";
import {
  getJSON as redisGetJSON,
  setJSON as redisSetJSON,
  delKey as redisDelKey,
} from "@/src/lib/redis-store";

// Reference getCorrelationId so the linter is satisfied when we use
// `correlationId` only in debug paths (the audit emitter injects it too).
void getCorrelationId;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNIN_RATE_LIMIT = {
  maxRequests: 20,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many sign-in attempts. Please try again in a minute.",
};

/**
 * Per-account failure threshold — 10 invalid-credential attempts in a
 * 10-minute rolling window trip a 15-minute lockout.
 */
const ACCOUNT_FAIL_THRESHOLD = 10;
const ACCOUNT_FAIL_WINDOW_SECONDS = 10 * 60; // 10 minutes
const ACCOUNT_LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes

/**
 * Per-IP failure threshold for requiring CAPTCHA on the NEXT attempt.
 * Separate from the 20/min hard rate limit above — this is a softer
 * signal that a client is probing credentials.
 */
const CAPTCHA_TRIGGER_THRESHOLD = 5;
const CAPTCHA_TRIGGER_WINDOW_SECONDS = 5 * 60; // 5 minutes

const GENERIC_AUTH_FAIL = "Invalid email or password.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignInResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string }
  | { ok: false; code: "CAPTCHA_REQUIRED"; message: string }
  | { ok: false; code: "CAPTCHA_FAILED"; message: string };

export type SignInActionInput = SignInInput & {
  /** CAPTCHA response token produced by the client widget (optional). */
  captchaToken?: string;
};

// ---------------------------------------------------------------------------
// Helpers — normalization + key derivation
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function accountKeyHash(email: string): string {
  return sha256Hex(normalizeEmail(email));
}

function accountFailCounterKey(email: string): string {
  return `rl:account-lockout:${accountKeyHash(email)}`;
}

function accountLockStateKey(email: string): string {
  return `rl:account-locked:${accountKeyHash(email)}`;
}

function accountLockoutEmailSentKey(email: string): string {
  return `rl:lockout-email-sent:${accountKeyHash(email)}`;
}

function ipFailCounterKey(ip: string): string {
  // Hash the IP too so the key layout stays uniform and doesn't leak
  // raw IPs into the Redis keyspace that operators audit.
  return `rl:signin-ip-fails:${sha256Hex(ip)}`;
}

// ---------------------------------------------------------------------------
// Helpers — in-memory fallback for counter state when Redis is unavailable
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: number;
  expiresAt: number; // epoch ms; 0 = no TTL
}

const memoryStore = new Map<string, MemoryEntry>();

function memoryGet(key: string): number | null {
  const e = memoryStore.get(key);
  if (!e) return null;
  if (e.expiresAt > 0 && e.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return e.value;
}

function memorySet(key: string, value: number, ttlSeconds: number): void {
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

function memoryDelete(key: string): void {
  memoryStore.delete(key);
}

/**
 * Test-only hook to clear the in-memory counter state between tests.
 * Not part of the public API contract.
 */
export async function __resetSigninLockoutStateForTests(): Promise<void> {
  memoryStore.clear();
}

// ---------------------------------------------------------------------------
// Unified get/set/incr/del that tries Redis then falls back to memory
// ---------------------------------------------------------------------------

async function counterGet(key: string): Promise<number> {
  const fromRedis = await redisGetJSON<number>(key);
  if (fromRedis !== null && typeof fromRedis === "number") return fromRedis;
  const fromMemory = memoryGet(key);
  return fromMemory ?? 0;
}

async function counterIncr(
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const current = await counterGet(key);
  const next = current + 1;
  const ok = await redisSetJSON(key, next, ttlSeconds);
  if (!ok) {
    memorySet(key, next, ttlSeconds);
  }
  return next;
}

async function counterReset(key: string): Promise<void> {
  await redisDelKey(key);
  memoryDelete(key);
}

async function flagGet(key: string): Promise<boolean> {
  const v = await redisGetJSON<unknown>(key);
  if (v !== null && v !== undefined) return true;
  return memoryGet(key) !== null;
}

async function flagSet(key: string, ttlSeconds: number): Promise<void> {
  const ok = await redisSetJSON(key, 1, ttlSeconds);
  if (!ok) memorySet(key, 1, ttlSeconds);
}

// ---------------------------------------------------------------------------
// Constant-time padding (mirrors signup)
// ---------------------------------------------------------------------------

/**
 * Burn CPU equivalent to a fresh bcrypt-10 hash so the wall-clock cost of
 * the locked-account path matches the happy-path sign-in. Any remaining
 * delta is swamped by network jitter.
 */
function dummyHashForTimingPad(password: string): void {
  try {
    const salt = randomBytes(16);
    scryptSync(password ?? "", salt, 32, { N: 16384, r: 8, p: 1 });
  } catch {
    // Swallow; the caller never uses the result.
  }
}

// ---------------------------------------------------------------------------
// Lockout notification email — throttled to one per lockout window
// ---------------------------------------------------------------------------

async function sendLockoutEmailOnce(
  email: string,
  lockoutEndsAt: Date,
): Promise<void> {
  const sentKey = accountLockoutEmailSentKey(email);
  try {
    const already = await flagGet(sentKey);
    if (already) return;
    await flagSet(sentKey, ACCOUNT_LOCKOUT_WINDOW_SECONDS);
  } catch {
    // Best-effort: fall through so at least one email is attempted.
  }

  try {
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const msg = renderAccountLockedEmail({
      email,
      lockoutEndsAt,
      resetUrl: `${baseUrl}/forgot-password`,
    });
    const provider = getEmailProvider();
    await provider.send(msg);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signIn:lockoutEmail",
      method: "ACTION",
      status: 500,
      message: e.message,
    });
  }
}

// ---------------------------------------------------------------------------
// CAPTCHA verification helper — resolves the provider label for metrics
// ---------------------------------------------------------------------------

function resolveCaptchaProviderLabel(): "turnstile" | "hcaptcha" | "disabled" {
  const raw = (process.env.DASHBOARD_CAPTCHA_PROVIDER ?? "").toLowerCase();
  if (raw === "turnstile") return "turnstile";
  if (raw === "hcaptcha") return "hcaptcha";
  return "disabled";
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function signInAction(
  input: SignInActionInput,
): Promise<SignInResult> {
  const parsed = signinSchema.safeParse(input);
  if (!parsed.success) {
    // Validation failures are uniform with bad-credential responses so an
    // attacker cannot distinguish "field shape invalid" from "credentials wrong".
    return { ok: false, message: GENERIC_AUTH_FAIL };
  }

  const emailNormalized = normalizeEmail(parsed.data.email);

  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const remoteIp = getClientIP(fakeReq);

  // ── Per-IP hard rate limit (20/min) ──────────────────────────────────────
  const ipRl = await checkRateLimit(fakeReq, "auth:signin", SIGNIN_RATE_LIMIT);
  if (!ipRl.allowed) {
    signinAttempts.inc({ outcome: "rate_limited", reason: "rate_limited" });
    emitAuthAudit({
      action: "signin_failed",
      outcome: "rate_limited",
      userId: "anonymous",
      reason: "ip_rate_limited",
      ip: remoteIp,
    });
    return { ok: false, message: SIGNIN_RATE_LIMIT.message };
  }

  // ── Lockout check (before any expensive work) ────────────────────────────
  // Must run BEFORE the counter increment so a locked account never
  // accumulates further failure counts within the lockout window.
  const lockKey = accountLockStateKey(emailNormalized);
  if (await flagGet(lockKey)) {
    // Constant-time pad so the locked path looks like a bcrypt-10 check.
    dummyHashForTimingPad(parsed.data.password);
    signinAttempts.inc({ outcome: "locked", reason: "account_locked" });
    emitAuthAudit({
      action: "signin_failed",
      outcome: "locked",
      userId: "anonymous",
      reason: "account_locked",
      ip: remoteIp,
    });
    return { ok: false, message: GENERIC_AUTH_FAIL };
  }

  // ── CAPTCHA gate: required when recent IP failures ≥ threshold ───────────
  const ipFailKey = ipFailCounterKey(remoteIp);
  const recentIpFails = await counterGet(ipFailKey);
  const captchaRequired = recentIpFails >= CAPTCHA_TRIGGER_THRESHOLD;

  if (captchaRequired) {
    const tokenStr =
      typeof input.captchaToken === "string" ? input.captchaToken : "";
    const captchaResult = await verifyCaptcha(tokenStr, remoteIp);
    if (!captchaResult.ok) {
      const providerLabel = resolveCaptchaProviderLabel();
      captchaFailures.inc({ provider: providerLabel });
      signinAttempts.inc({ outcome: "failed", reason: "captcha_failed" });
      emitAuthAudit({
        action: "captcha_failed",
        outcome: "failed",
        userId: "anonymous",
        reason: "signin",
        ip: remoteIp,
      });
      // Missing token → CAPTCHA_REQUIRED (render the widget).
      // Bad token → CAPTCHA_FAILED (widget already rendered; user must retry).
      if (tokenStr.length === 0) {
        return {
          ok: false,
          code: "CAPTCHA_REQUIRED",
          message: "Please complete the verification challenge.",
        };
      }
      return {
        ok: false,
        code: "CAPTCHA_FAILED",
        message: "Verification challenge failed. Please try again.",
      };
    }
  }

  // ── Attempt sign-in ──────────────────────────────────────────────────────
  try {
    await auth.api.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: reqHeaders,
    });

    // On success: clear the per-account failure counter. IP failure counter
    // is left to age out on its own — a single success on an IP with recent
    // fails should not immediately re-enable brute forcing from the same IP.
    try {
      await counterReset(accountFailCounterKey(emailNormalized));
    } catch {
      // Best-effort; continue.
    }

    signinAttempts.inc({ outcome: "ok", reason: "" });
    emitAuthAudit({
      action: "signin_succeeded",
      outcome: "ok",
      userId: "anonymous",
      ip: remoteIp,
    });
    return { ok: true, redirectTo: "/dashboard/default" };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signIn",
      method: "ACTION",
      status: 401,
      message: e.message,
    });

    // Bump per-account counter (lockout trigger).
    let accountCount = 0;
    try {
      accountCount = await counterIncr(
        accountFailCounterKey(emailNormalized),
        ACCOUNT_FAIL_WINDOW_SECONDS,
      );
    } catch {
      // Counter backend unavailable — we cannot track failures reliably.
      // Fall through with count=0; the IP-level 20/min limiter still holds.
    }

    // Bump per-IP counter (CAPTCHA trigger).
    try {
      await counterIncr(
        ipFailCounterKey(remoteIp),
        CAPTCHA_TRIGGER_WINDOW_SECONDS,
      );
    } catch {
      // Best-effort.
    }

    signinAttempts.inc({ outcome: "failed", reason: "invalid_credentials" });

    // Transition into locked state on the attempt that just pushed the
    // count past the threshold. Subsequent failures within the window
    // short-circuit at the lockout check above.
    if (accountCount > ACCOUNT_FAIL_THRESHOLD) {
      const lockoutEndsAt = new Date(
        Date.now() + ACCOUNT_LOCKOUT_WINDOW_SECONDS * 1000,
      );
      try {
        await flagSet(lockKey, ACCOUNT_LOCKOUT_WINDOW_SECONDS);
      } catch {
        // Best-effort; audit + metric still fire.
      }
      accountLockouts.inc();
      emitAuthAudit({
        action: "account_locked",
        outcome: "locked",
        userId: "anonymous",
        reason: "failed_login_threshold",
        ip: remoteIp,
      });
      // Fire-and-forget — must never delay the sign-in response.
      void sendLockoutEmailOnce(emailNormalized, lockoutEndsAt);
    } else {
      emitAuthAudit({
        action: "signin_failed",
        outcome: "failed",
        userId: "anonymous",
        reason: "invalid_credentials",
        ip: remoteIp,
      });
    }

    return {
      ok: false,
      message: isDebug ? `signInEmail: ${e.message}` : GENERIC_AUTH_FAIL,
    };
  }
}
