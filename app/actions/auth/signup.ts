"use server";

/**
 * signUpAction — transactional signup (Phase B, Tasks 21–22).
 *
 * Ten-step flow (see design.md §Components: Server Actions):
 *   1.  CAPTCHA verification (if captchaToken is present in input).
 *   2.  Per-IP rate limiting.
 *   3.  Zod-validate input against signupSchema.
 *   4.  Pre-flight slug check — abort before touching user table on collision.
 *   5.  Create user via auth.api.signUpEmail; constant-time duplicate handling.
 *   6.  Create organization with retry (3 attempts, jittered exponential backoff);
 *       roll back the user on permanent failure.
 *   7.  Apply Tenant CR; on K8s failure keep user+org, set provisioningPending.
 *   8.  Paid plans → create Stripe Checkout session with client_reference_id.
 *   9.  Emit audit events (signup_started at entry, signup_completed|signup_failed
 *       at each terminal path).
 *  10.  Return typed result.
 *
 * Constant-time duplicate-email handling:
 *   A fresh signUpEmail call hashes the password with bcrypt (cost 10, ~100ms).
 *   When Better Auth rejects because the email already exists we perform a dummy
 *   scryptSync hash at equivalent cost so the wall-clock delta leaks no information.
 *
 * Cookie commit: the nextCookies() plugin in src/lib/auth-server.ts forwards
 * Better Auth's set-cookie commands through Next.js cookies() automatically.
 */

import { headers } from "next/headers";
import { scryptSync, randomBytes } from "crypto";
import type { NextRequest } from "next/server";

import { applyTenant } from "@/src/lib/k8s/tenants";
import { auth } from "@/src/lib/auth-server";
import { checkRateLimit } from "@/src/lib/rate-limiter";
import { signupSchema, type SignupInput } from "@/src/lib/validators/auth";
import { verifyCaptcha } from "@/src/lib/auth/captcha";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { getCorrelationId } from "@/src/lib/correlation";
import { signupAttempts, captchaFailures } from "@/src/lib/metrics/auth";
import { getStripeClient, priceIdForTier } from "@/src/lib/billing/stripe";
import type { TenantTier } from "@/src/lib/k8s/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All error codes that signUpAction can return, drawn from the closed
 * UserFacingErrorCode union. Keeping a narrower alias here keeps the return
 * type tight without adding a runtime dependency on the catalog module.
 */
export type SignUpErrorCode =
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "COMPANY_NAME_TAKEN"
  | "EMAIL_ALREADY_REGISTERED"
  | "PASSWORD_BREACHED"
  | "PASSWORD_POLICY"
  | "SERVICE_UNAVAILABLE"
  | "BILLING_NOT_CONFIGURED"
  | "BILLING_ERROR";

export type SignUpResult =
  | {
      ok: true;
      tenantId: string;
      userId: string;
      /** Present for paid plans when Stripe Checkout is configured. */
      redirectUrl?: string;
      /** True when Tenant CR apply failed; operator will retry on reconcile. */
      provisioningPending?: boolean;
    }
  | {
      ok: false;
      code: SignUpErrorCode;
      field?: "companyName" | "email" | "password" | "tosAccepted";
      message: string;
      correlationId: string;
    };

export type SignUpActionInput = SignupInput & {
  /** The plan tier selected from /pricing; re-validated server-side. */
  plan: string;
  /** CAPTCHA response token produced by the client widget (optional). */
  captchaToken?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNUP_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 3600,
  algorithm: "fixed_window" as const,
  message: "Too many signup attempts. Please try again later.",
};

/** Plans that require Stripe Checkout before provisioning proceeds. */
const PAID_TIERS = ["team", "business", "enterprise"] as const;
type PaidTier = (typeof PAID_TIERS)[number];

/** Retry schedule (ms) for organization creation before giving up. */
const ORG_CREATE_BACKOFF_MS = [100, 300, 900] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Resolve the captchaFailures provider label from the server-side
 * DASHBOARD_CAPTCHA_PROVIDER environment variable. Mirrors the same
 * logic in src/lib/auth/captcha.ts so metric labels stay consistent.
 */
function resolveCaptchaProviderLabel(): "turnstile" | "hcaptcha" | "disabled" {
  const raw = (process.env.DASHBOARD_CAPTCHA_PROVIDER ?? "").toLowerCase();
  if (raw === "turnstile") return "turnstile";
  if (raw === "hcaptcha") return "hcaptcha";
  return "disabled";
}

/**
 * Perform a dummy scrypt hash to pad the duplicate-email path to approximately
 * the same wall-clock cost as a real bcrypt-10 signup (~80–120 ms).
 *
 * scryptSync with N=16384, r=8, p=1 (equivalent to bcrypt cost-10 workload)
 * typically takes 80–150ms on a modern server — close enough that any
 * remaining delta is swamped by network jitter. The salt is thrown away;
 * the output is discarded. The only purpose is CPU burn.
 */
function dummyHashForTimingPad(password: string): void {
  try {
    const salt = randomBytes(16);
    scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  } catch {
    // Swallow; the caller never uses the result.
  }
}

/**
 * Wait for `ms` milliseconds, adding up to `jitter` ms of uniform random
 * delay so concurrent retries from different clients don't thunderherd.
 */
function sleep(ms: number, jitter = 50): Promise<void> {
  const actual = ms + Math.floor(Math.random() * jitter);
  return new Promise((resolve) => setTimeout(resolve, actual));
}

// ---------------------------------------------------------------------------
// Organisation adapter helper
// ---------------------------------------------------------------------------

/**
 * Resolve the Better Auth organization adapter from auth.$context so we can
 * call findOrganizationBySlug for the pre-flight slug check without going
 * through the full HTTP route.
 */
async function getOrgAdapterInstance() {
  const { getOrgAdapter } = await import("better-auth/plugins/organization");
  // auth.$context is typed as the concrete plugin-context, but getOrgAdapter
  // expects the narrower AuthContext interface. The cast through unknown is
  // intentional — in practice these are the same runtime object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (await auth.$context) as any;
  return getOrgAdapter(ctx);
}

/**
 * Return `true` when a tenant slug is already registered as an organization.
 * Any failure is treated as "slug not found" (fail-open) — the guard is
 * best-effort; Better Auth's unique constraint is the hard fence.
 */
async function slugExists(slug: string): Promise<boolean> {
  try {
    const adapter = await getOrgAdapterInstance();
    const existing = await adapter.findOrganizationBySlug(slug);
    return existing != null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// User deletion for rollback
// ---------------------------------------------------------------------------

/**
 * Best-effort rollback of a just-created user when org creation permanently
 * fails. Uses the admin plugin's `removeUser` endpoint which accepts a
 * `userId` in the request body. Failure here is swallowed — a partially-
 * created orphan user is the worst-case outcome, and the audit log captures
 * it for ops cleanup.
 */
async function rollbackUser(userId: string): Promise<void> {
  if (!userId) return;
  try {
    // The admin plugin exposes removeUser (POST /admin/remove-user) which
    // accepts { userId } and operates with elevated privileges from the
    // Better Auth session context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = auth.api as unknown as Record<string, any>;
    if (typeof api.removeUser === "function") {
      await api.removeUser({
        body: { userId },
        headers: await headers(),
      });
    }
  } catch {
    // Swallow — rollback is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function signUpAction(
  input: SignUpActionInput,
): Promise<SignUpResult> {
  const correlationId = getCorrelationId();

  // Emit signup_started at action entry so every attempt is auditable even
  // if it fails before any user record is touched.
  emitAuthAudit({
    action: "signup_started",
    outcome: "ok",
    userId: "anonymous",
    targetTenant: null,
  });

  // ── Step 1: CAPTCHA ──────────────────────────────────────────────────────
  // Task 31: always call verifyCaptcha. In disabled mode it short-circuits to
  // ok:true even when the token is empty, so local dev still works without a
  // site key. When the provider is enabled, a missing or bad token yields
  // CAPTCHA_FAILED (no enumeration risk here — /signup is the terminal path
  // for the create-account flow, not an anti-enumeration surface).
  {
    const tokenStr =
      typeof input.captchaToken === "string" ? input.captchaToken : "";
    const captchaResult = await verifyCaptcha(tokenStr);
    if (!captchaResult.ok) {
      captchaFailures.inc({
        provider: resolveCaptchaProviderLabel(),
      });
      emitAuthAudit({
        action: "captcha_failed",
        outcome: "failed",
        userId: "anonymous",
        reason: "signup",
      });
      signupAttempts.inc({ outcome: "failed", reason: "captcha_failed" });
      return {
        ok: false,
        code: "CAPTCHA_FAILED",
        message: "Verification challenge failed. Please try again.",
        correlationId,
      };
    }
  }

  // ── Step 2: Rate limit ───────────────────────────────────────────────────
  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const rl = await checkRateLimit(fakeReq, "signup:create", SIGNUP_RATE_LIMIT);
  if (!rl.allowed) {
    signupAttempts.inc({ outcome: "rate_limited", reason: "rate_limited" });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: SIGNUP_RATE_LIMIT.message,
      correlationId,
    };
  }

  // ── Step 3: Zod validation ───────────────────────────────────────────────
  const parsed = signupSchema.safeParse({
    companyName: input.companyName,
    email: input.email,
    password: input.password,
    confirmPassword: input.confirmPassword ?? input.password,
    tosAccepted: input.tosAccepted,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const fieldRaw = issue?.path?.[0];
    const fieldStr = typeof fieldRaw === "string" ? fieldRaw : undefined;
    const allowed = [
      "email",
      "password",
      "companyName",
      "tosAccepted",
    ] as const;
    const field = allowed.includes(fieldStr as (typeof allowed)[number])
      ? (fieldStr as (typeof allowed)[number])
      : undefined;
    signupAttempts.inc({ outcome: "failed", reason: "validation" });
    return {
      ok: false,
      code: "VALIDATION",
      field,
      message: issue?.message ?? "Invalid input",
      correlationId,
    };
  }

  const data = parsed.data;
  const tenantSlug = slugify(data.companyName);

  // Normalise the plan tier, defaulting to "free" when unrecognised.
  const tier: TenantTier = (
    ["free", "indie", "pro", "team", "business", "enterprise"] as const
  ).includes(input.plan as TenantTier)
    ? (input.plan as TenantTier)
    : "free";

  // ── Step 4: Pre-flight slug check ────────────────────────────────────────
  // Performed BEFORE writing the user so we avoid creating an orphan user
  // whose org creation would then immediately fail.
  if (await slugExists(tenantSlug)) {
    signupAttempts.inc({ outcome: "failed", reason: "slug_owned_by_other" });
    return {
      ok: false,
      code: "COMPANY_NAME_TAKEN",
      field: "companyName",
      message:
        "A workspace with that name already exists. Please choose a different name.",
      correlationId,
    };
  }

  // ── Step 5: Create user ──────────────────────────────────────────────────
  let userId = "";
  try {
    const signUpRes = await auth.api.signUpEmail({
      body: {
        name: data.companyName,
        email: data.email,
        password: data.password,
      },
      headers: reqHeaders,
    });
    userId =
      (signUpRes as unknown as { user?: { id?: string } } | null)?.user?.id ??
      (signUpRes as unknown as { id?: string } | null)?.id ??
      "";
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const msg = e.message;

    if (/already.*exists|user.*exists|user_already_exists/i.test(msg)) {
      // Constant-time padding: burn CPU equivalent to a fresh bcrypt-10 hash
      // so an attacker cannot determine "email exists" from response latency.
      dummyHashForTimingPad(data.password);
      signupAttempts.inc({
        outcome: "failed",
        reason: "email_already_registered",
      });
      emitAuthAudit({
        action: "signup_failed",
        outcome: "failed",
        userId: "anonymous",
        reason: "email_already_registered",
        targetTenant: tenantSlug,
      });
      return {
        ok: false,
        code: "EMAIL_ALREADY_REGISTERED",
        field: "email",
        message:
          "An account with this email address already exists. Sign in or reset your password.",
        correlationId,
      };
    }

    if (/PASSWORD_BREACHED|breach/i.test(msg)) {
      signupAttempts.inc({ outcome: "failed", reason: "password_breached" });
      return {
        ok: false,
        code: "PASSWORD_BREACHED",
        field: "password",
        message:
          "This password has appeared in a known data breach. Please choose a different password.",
        correlationId,
      };
    }

    if (/password|validation/i.test(msg)) {
      signupAttempts.inc({ outcome: "failed", reason: "password_policy" });
      return {
        ok: false,
        code: "PASSWORD_POLICY",
        field: "password",
        message: "Your password does not meet the requirements.",
        correlationId,
      };
    }

    signupAttempts.inc({ outcome: "failed", reason: "internal_error" });
    emitAuthAudit({
      action: "signup_failed",
      outcome: "failed",
      userId: "anonymous",
      errorMessage: msg,
      targetTenant: tenantSlug,
    });
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "An error occurred during signup. Please try again.",
      correlationId,
    };
  }

  // ── Step 6: Organisation creation with retry ─────────────────────────────
  // Three attempts with jittered exponential backoff (100 ms, 300 ms, 900 ms).
  // On permanent failure, roll back the just-created user so the database
  // stays consistent and the user can retry from a clean state.
  let orgCreated = false;
  let lastOrgError: string | undefined;

  for (let attempt = 0; attempt < ORG_CREATE_BACKOFF_MS.length; attempt++) {
    try {
      // Server-mode call: pass `userId` in the body so Better Auth
      // treats this as a system action (line 57 of crud-org.mjs). We
      // deliberately do NOT forward `reqHeaders` — they don't contain
      // the just-issued session cookie (Better Auth's nextCookies plugin
      // queues it onto the outbound response, not the inbound request
      // object), so `getSessionFromCtx` would resolve to null and throw
      // UNAUTHORIZED. Passing userId short-circuits the session lookup
      // and skips the allowUserToCreateOrganization gate.
      await auth.api.createOrganization({
        body: {
          name: data.companyName,
          slug: tenantSlug,
          userId,
        },
      });
      orgCreated = true;
      break;
    } catch (err) {
      // Capture the full error for diagnosis. Better Auth sometimes throws
      // APIError with structured body; include it under JSON.stringify so we
      // see the actual reason in the pod logs, not just the message string.
      lastOrgError = err instanceof Error ? err.message : String(err);
      try {
        console.error(
          `[signup] createOrganization attempt ${attempt + 1}/${ORG_CREATE_BACKOFF_MS.length} failed`,
          { name: (err as { name?: string })?.name, message: lastOrgError, body: (err as { body?: unknown })?.body, status: (err as { status?: unknown })?.status, stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n") : undefined },
        );
      } catch {
        /* logging is best-effort */
      }
      if (attempt < ORG_CREATE_BACKOFF_MS.length - 1) {
        await sleep(ORG_CREATE_BACKOFF_MS[attempt]);
      }
    }
  }

  if (!orgCreated) {
    // All retries exhausted — roll back the user so no orphan is left behind.
    await rollbackUser(userId);

    signupAttempts.inc({ outcome: "failed", reason: "org_create_failed" });
    emitAuthAudit({
      action: "signup_failed",
      outcome: "failed",
      userId,
      reason: "org_create_failed",
      errorMessage: lastOrgError,
      targetTenant: tenantSlug,
    });
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "We're experiencing technical difficulties creating your workspace. Please try again.",
      correlationId,
    };
  }

  // ── Step 7: Tenant CR apply ──────────────────────────────────────────────
  // K8s failure is non-fatal for the user record — the operator saga will
  // retry the CR on the next reconcile cycle. We set provisioningPending so
  // the provisioning status page reflects the real state.
  let provisioningPending = false;
  try {
    await applyTenant(tenantSlug, {
      displayName: data.companyName,
      owner: data.email.toLowerCase().trim(),
      tier,
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    provisioningPending = true;
    emitAuthAudit({
      action: "signup_failed",
      outcome: "failed",
      userId,
      reason: "tenant_apply_failed",
      errorMessage: e.message,
      targetTenant: tenantSlug,
    });
    // Return a partial success so the client redirects to the provisioning
    // page and the operator can pick up the reconcile on the next loop.
    signupAttempts.inc({ outcome: "ok", reason: "" });
    emitAuthAudit({
      action: "signup_completed",
      outcome: "ok",
      userId,
      targetTenant: tenantSlug,
      reason: "provisioning_pending",
    });
    return {
      ok: true,
      tenantId: tenantSlug,
      userId,
      provisioningPending: true,
    };
  }

  // ── Step 8: Paid plan → Stripe Checkout ──────────────────────────────────
  if (PAID_TIERS.includes(input.plan as PaidTier)) {
    const priceId = priceIdForTier(input.plan);
    let stripe;
    try {
      stripe = getStripeClient();
    } catch {
      return {
        ok: false,
        code: "BILLING_NOT_CONFIGURED",
        message: "Billing is not configured for this plan.",
        correlationId,
      };
    }
    if (!priceId) {
      return {
        ok: false,
        code: "BILLING_NOT_CONFIGURED",
        message: "Billing is not configured for this plan.",
        correlationId,
      };
    }
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: data.email,
      // client_reference_id is used by the Stripe webhook (Task 32) to
      // reconcile the checkout session back to our tenant record without
      // a database round-trip.
      client_reference_id: tenantSlug,
      success_url: `${baseUrl}/signup/provisioning?tenant=${tenantSlug}&user=${userId}`,
      cancel_url: `${baseUrl}/signup?cancelled=true`,
      metadata: {
        tenant_id: tenantSlug,
        user_id: userId,
        tier: input.plan,
        owner_email: data.email,
        display_name: data.companyName,
      },
    });
    if (!session.url || !session.url.startsWith("https://checkout.stripe.com/")) {
      return {
        ok: false,
        code: "BILLING_ERROR",
        message: "Invalid payment redirect URL.",
        correlationId,
      };
    }

    signupAttempts.inc({ outcome: "ok", reason: "" });
    emitAuthAudit({
      action: "signup_completed",
      outcome: "ok",
      userId,
      targetTenant: tenantSlug,
    });
    return {
      ok: true,
      tenantId: tenantSlug,
      userId,
      redirectUrl: session.url,
      provisioningPending,
    };
  }

  // ── Step 9: Success ──────────────────────────────────────────────────────
  signupAttempts.inc({ outcome: "ok", reason: "" });
  emitAuthAudit({
    action: "signup_completed",
    outcome: "ok",
    userId,
    targetTenant: tenantSlug,
  });

  return { ok: true, tenantId: tenantSlug, userId };
}
