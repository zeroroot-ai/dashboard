"use server";

/**
 * signUpAction
 *
 * Server Action that replaces the public POST /api/auth/sign-up/email +
 * POST /api/auth/organization/create + POST /api/signup chain. The browser
 * calls this directly via the React Server Action RPC; there is no public
 * HTTP endpoint to curl.
 *
 * Flow:
 *   1. Zod-validate input against the shared signupSchema.
 *   2. Per-IP rate limit (10/hr, fixed window).
 *   3. auth.api.signUpEmail(...) — creates user + session in-process.
 *   4. auth.api.organization.create(...) using the freshly-issued session
 *      headers — best-effort; failure is non-fatal because the operator
 *      will materialise the org via the SPIFFE-authenticated admin route
 *      on the Tenant CR's reconcile.
 *   5. provisionTenantAction(...) — creates the Tenant CRD; the operator
 *      runs the saga.
 *
 * Anti-enumeration: a duplicate email returns ok:true with the existing
 * user/tenant slug so the page redirects to /signup/provisioning the same
 * way it would for a new account.
 *
 * Cookie commit: the nextCookies() plugin in src/lib/auth-server.ts
 * forwards Better Auth's set-cookie commands through Next.js cookies() so
 * the session token is on the response without manual header copying.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { applyTenant, tenantNamespace } from "@/src/lib/k8s/tenants";
import { K8sError } from "@/src/lib/k8s/errors";
import { emitCrdAudit } from "@/src/lib/audit/crd";
import { auth } from "@/src/lib/auth-server";
import {
  isDebug,
  recordDebugError,
} from "@/src/lib/debug";
import { checkRateLimit } from "@/src/lib/rate-limiter";
import type { TenantTier } from "@/src/lib/k8s/types";
import { signupSchema, type SignupInput } from "@/src/lib/validators/auth";

const SIGNUP_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 3600,
  algorithm: "fixed_window" as const,
  message: "Too many signup attempts. Please try again later.",
};

const PAID_TIERS = ["team", "business", "enterprise"] as const;
type PaidTier = (typeof PAID_TIERS)[number];

export type SignUpResult =
  | {
      ok: true;
      tenantId: string;
      userId: string;
      // Set when the selected plan is a paid tier and Stripe Checkout is
      // configured. The form should `window.location` to it.
      redirectUrl?: string;
    }
  | {
      ok: false;
      field?: "email" | "password" | "companyName" | "tosAccepted";
      code: string;
      message: string;
    };

export type SignUpActionInput = SignupInput & {
  // The form sends a tier selected from /pricing. We re-validate
  // server-side and default to "free" on anything we don't recognise.
  plan: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function signUpAction(input: SignUpActionInput): Promise<SignUpResult> {
  // 1. Validate. We strip plan before parse since signupSchema doesn't
  //    own that field.
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
    const allowed = ["email", "password", "companyName", "tosAccepted"] as const;
    const field = allowed.includes(fieldStr as (typeof allowed)[number])
      ? (fieldStr as (typeof allowed)[number])
      : undefined;
    return {
      ok: false,
      field,
      code: "VALIDATION",
      message: issue?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;
  const tenantSlug = slugify(data.companyName);

  // 2. Rate limit. Server Actions don't carry a NextRequest, but
  //    checkRateLimit only reads .headers, so a synthetic shape is OK.
  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const rl = await checkRateLimit(fakeReq, "signup:create", SIGNUP_RATE_LIMIT);
  if (!rl.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: SIGNUP_RATE_LIMIT.message,
    };
  }

  // 3. Better Auth user + session, in-process. asResponse:false so we
  //    get the typed payload; nextCookies() handles the set-cookie.
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
    // Anti-enumeration: treat existing email as success and route the
    // user to the provisioning page where status will reflect reality.
    if (/already.*exists|user.*exists|user_already_exists/i.test(msg)) {
      return finishExisting(data, tenantSlug);
    }
    if (/password|validation/i.test(msg)) {
      return {
        ok: false,
        field: "password",
        code: "PASSWORD",
        message: isDebug ? msg : "Your password does not meet the requirements.",
      };
    }
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signUp",
      method: "ACTION",
      status: 500,
      message: msg,
      stack: e.stack,
    });
    return {
      ok: false,
      code: "SIGNUP_FAILED",
      message: isDebug ? `signUpEmail: ${msg}` : "An error occurred. Please try again.",
    };
  }

  // 4. Best-effort organization creation. Failure is non-fatal — the
  //    tenant-operator will create it via the admin route during the
  //    saga, so we never want this to block provisioning.
  try {
    await auth.api.createOrganization({
      body: {
        name: data.companyName,
        slug: tenantSlug,
      },
      headers: reqHeaders,
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signUp.createOrg",
      method: "ACTION",
      status: 200,
      message: e.message,
    });
    // continue — operator's saga will attempt org creation
  }

  // 5. Tenant CRD provisioning. Signup orchestrates tenant creation itself —
  // the user has no cross-tenant role yet, so provisionTenantAction's
  // gate would (correctly) deny them. Signup's own rate limiter + Better
  // Auth signup protection is the authorization boundary for this path.
  const tier: TenantTier = (["free", "pro", "enterprise"] as const).includes(
    input.plan as "free" | "pro" | "enterprise",
  )
    ? (input.plan as TenantTier)
    : "free";
  try {
    const t = await applyTenant(tenantSlug, {
      displayName: data.companyName,
      owner: data.email.toLowerCase().trim(),
      tier,
    });
    emitCrdAudit({
      ts: new Date().toISOString(),
      action: "provisionTenantAction",
      outcome: "ok",
      userId,
      sessionTenantId: null,
      targetTenant: t.metadata.name,
      crossTenant: false,
      inputKeys: ["displayName", "owner", "tier"],
      resourceRef: t.metadata.name,
    });
    // t.metadata.name + tenantNamespace(t.metadata.name) match the original
    // provisionTenantAction return shape; kept for downstream consumers.
    void tenantNamespace(t.metadata.name);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signUp.provisionTenant",
      method: "ACTION",
      status: 503,
      message: e.message,
    });
    const k8sErr = err as K8sError;
    emitCrdAudit({
      ts: new Date().toISOString(),
      action: "provisionTenantAction",
      outcome: "internal",
      userId,
      sessionTenantId: null,
      targetTenant: tenantSlug,
      crossTenant: false,
      inputKeys: ["displayName", "owner", "tier"],
      errorCode: k8sErr.name,
      errorMessage: e.message,
    });
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: isDebug
        ? `provisioning error: ${e.message}`
        : "We're experiencing technical difficulties. Please try again in a moment.",
    };
  }

  // 6. Paid tier → Stripe Checkout redirect.
  if (PAID_TIERS.includes(input.plan as PaidTier)) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env[`STRIPE_PRICE_${input.plan.toUpperCase()}`];
    if (!stripeSecretKey || !priceId) {
      return {
        ok: false,
        code: "BILLING_NOT_CONFIGURED",
        message: "Billing is not configured for this plan.",
      };
    }
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeSecretKey);
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: data.email,
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
      };
    }
    return {
      ok: true,
      tenantId: tenantSlug,
      userId,
      redirectUrl: session.url,
    };
  }

  return { ok: true, tenantId: tenantSlug, userId };
}

// Anti-enumeration helper: when Better Auth says the user already
// exists, we still hand the form a success-shape result so it routes to
// the provisioning page. The provisioning page polls the Tenant CR; if
// the tenant exists already it redirects; if not, the operator picks it
// up on the next reconcile.
async function finishExisting(data: SignupInput, tenantSlug: string): Promise<SignUpResult> {
  await applyTenant(tenantSlug, {
    displayName: data.companyName,
    owner: data.email.toLowerCase().trim(),
    tier: "free",
  }).catch(() => undefined);
  return { ok: true, tenantId: tenantSlug, userId: "" };
}
