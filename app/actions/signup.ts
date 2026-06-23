"use server";

/**
 * @server-action-authz-exempt: pre-authentication, signup runs before any
 * session or tenant exists; it is the action that creates them. Abuse is
 * gated by CAPTCHA + email-nonce, not session authz.
 *
 * signupAction, the dashboard-native signup pipeline.
 *
 * A single linear orchestration: form input → daemon owner provisioning →
 * Tenant CR → operator saga → TenantMember CR → redirect to /login. Each step
 * emits progress to the daemon signup-progress store for the client-side
 * ProvisioningPanel to poll; each failure short-circuits and maps to a
 * user-safe `SignupFailureCode`.
 *
 * Owner-user provisioning (create-or-resume the Zitadel human user, set
 * password, send verification email) runs DAEMON-SIDE via the unauthenticated
 * `gibson.tenant.v1.SignupService.Signup` RPC (gibson#812). The dashboard no
 * longer holds a privileged Zitadel signup-bot PAT (dashboard#812 / E9). The
 * operator owns the rest once the Tenant CR is applied — per-tenant Zitadel
 * org + FGA tuples + Langfuse/Stripe/Redis/Neo4j init all happen downstream.
 * This action stays focused on:
 *   (1) provisioning the founding-owner identity via the daemon RPC,
 *   (2) applying the CRs that trigger the saga,
 *   (3) surfacing saga status back to the user as progress.
 *
 * The caller is always redirected through the standard `/login` flow for
 * sign-in; this action never mints a dashboard session. Zitadel remains the
 * single source of truth for authenticated identity.
 *
 * Spec: dashboard-native-signup, task 13; E9 / dashboard#812 (PAT removal).
 */

import "server-only";

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";

import { ConnectError, Code } from "@connectrpc/connect";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import {
  signupInputSchema,
  type SignupInput,
  type SignupActionResult,
  type CompleteSignupInput,
  type SignupFailureCode,
  type ProvisioningStep,
} from "@/app/(public)/signup/types";
import {
  findOrCreateSignupCustomer,
  verifySignupCustomer,
  finalizeSignupCustomer,
  createSetupIntent,
  createTrialingSubscription,
  priceIdForTier,
  type BillingTier,
} from "@/src/lib/billing/stripe";
import { billingEnabled } from "@/src/lib/billing/billing-enabled";
import { lookupPlan, type PlanID } from "@/src/generated/plans";
import { selfServeTierIds } from "@/src/lib/pricing-display";
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
} from "@/src/lib/zitadel/password-policy-cache";
import { provisionSignupOwner } from "@/src/lib/signup/owner-provisioning";
import {
  applyTenant,
  applyTenantMember,
  getTenant,
  tenantNamespace,
} from "@/src/lib/k8s/tenants";
import type { Tenant, TenantMember, TenantTier } from "@/src/lib/k8s/types";
// Note: listTenantsForOwner / src/lib/k8s/tenants-by-owner.ts deleted under
// spec `tenant-membership-not-in-jwt`. Duplicate-signup detection now relies
// on the daemon SignupService.Signup RPC being idempotent on owner email
// (it resumes an existing owner user) plus the tenant-operator's idempotent
// reconcile keyed by zitadel_sub.
import { checkSignupRateLimit } from "@/src/lib/signup/rate-limit";
import {
  advanceStep,
  completeProgress,
  failProgress,
} from "@/src/lib/signup/progress-store";
import { k8s } from "@/src/lib/k8s/client";
import { logger } from "@/src/lib/logger";


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How long to wait for Tenant.status.zitadelOrgID to appear. */
const TENANT_READY_TIMEOUT_MS = 60_000;
/** How long to wait for the TenantMember to transition to Active. */
const MEMBER_READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Post-signup destination. Routes through /login so the LoginForm client
 * component invokes Auth.js v5's CSRF-protected signIn("zitadel"), which
 * POSTs to /api/auth/signin/zitadel with the required tokens.
 *
 * The auto-login path (issue dashboard#41) is retired in E9 (dashboard#812):
 * it depended on a broad signup-bot Zitadel PAT holding IAM_LOGIN_CLIENT
 * (gitops#90, never merged), so auto-login already fell back to /login at
 * runtime. Restoring it via a narrow login-scoped credential is tracked as a
 * follow-up; until then /login is the single post-signup path.
 *
 * NOTE: don't redirect directly to /api/auth/signin/zitadel, Auth.js v5
 * removed the GET-based sign-in initiation that v4 supported, and a GET to
 * that endpoint now throws `UnknownAction` and bounces back to
 * /login?error=Configuration.
 */
const POST_SIGNUP_REDIRECT = "/login?callbackUrl=%2Fdashboard";

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function signupAction(
  rawInput: SignupInput,
  /**
   * Optional client-supplied attempt id. The form mints this BEFORE invoking
   * the action and renders the holding-page <ProvisioningPanel> with it
   * immediately, so the user sees progress while this action is still
   * running. Server validates the format defensively. When absent (e.g.
   * direct invocation from a test) we mint our own.
   */
  clientAttemptId?: string,
): Promise<SignupActionResult> {
  const attemptId =
    clientAttemptId && UUID_RE.test(clientAttemptId)
      ? clientAttemptId
      : randomUUID();

  // Pipeline context, mutable as steps run; never returned to the caller.
  const ctx: Ctx = {
    attemptId,
    input: rawInput,
    zitadelUserId: undefined,
    tenantSlug: undefined,
  };

  try {
    // 0. Schema guard (defence-in-depth; Client Component already validates).
    const parsed = signupInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const fieldErrors: NonNullable<
        Exclude<SignupActionResult, { ok: true }>["fieldErrors"]
      > = {};
      for (const issue of parsed.error.issues) {
        if (issue.path.length > 0) {
          fieldErrors[issue.path[0] as keyof SignupInput] = issue.message;
        }
      }
      return {
        ok: false,
        attemptId,
        code: first?.code === "invalid_literal" ? "TOS_MISSING" : "INTERNAL_ERROR",
        userMessage: first?.message ?? "Invalid form submission",
        fieldErrors,
      };
    }
    ctx.input = parsed.data;

    // Normalize email to lowercase + trim, every downstream comparison
    // (existing-user lookup, tenant-owner list, rate-limit email key) must
    // use this canonical form.
    ctx.input = {
      ...ctx.input,
      email: ctx.input.email.trim().toLowerCase(),
      firstName: ctx.input.firstName.trim(),
      lastName: ctx.input.lastName.trim(),
      workspaceName: ctx.input.workspaceName.trim(),
    };

    // 1. Rate limit.
    await advanceStep(attemptId, "rate_limit");
    const ip = await resolveClientIp();
    const rateLimit = await checkSignupRateLimit(ip, ctx.input.email);
    if (!rateLimit.allowed) {
      return await finish(ctx, "rate_limit", {
        code: "RATE_LIMITED",
        userMessage: `Too many signup attempts. Try again in ${Math.ceil(
          rateLimit.retryAfterMs / 60_000,
        )} minute(s).`,
      });
    }

    // 2. Password policy (advisory, client-side strength meter only). The
    //    daemon enforces the real policy at user-create time, so this is a
    //    best-effort early-reject using the default policy constant; the
    //    dashboard no longer fetches the live Zitadel policy (E9, no PAT).
    await advanceStep(attemptId, "policy");
    const policyFail = checkPasswordAgainstPolicy(
      ctx.input.password,
      DEFAULT_PASSWORD_POLICY,
    );
    if (policyFail) {
      return await finish(ctx, "policy", {
        code: "POLICY_VIOLATION",
        userMessage: policyFail,
        fieldErrors: { password: policyFail },
      });
    }

    // 3. Workspace-name availability.
    ctx.tenantSlug = slugify(ctx.input.workspaceName);
    if (!ctx.tenantSlug) {
      return await finish(ctx, "policy", {
        // dashboard#44: user-visible copy uses "company name"; the
        // internal code, error code, and field name stay as
        // workspaceName/WORKSPACE_TAKEN to avoid moving downstream wiring.
        code: "INTERNAL_ERROR",
        userMessage: "That company name isn't available, pick another.",
        fieldErrors: { workspaceName: "Invalid company name" },
      });
    }
    const existingTenant = await safeGetTenant(ctx.tenantSlug);
    if (existingTenant) {
      // Deliberately vague, no info-leak on whether the owner is someone else.
      return await finish(ctx, "policy", {
        code: "WORKSPACE_TAKEN",
        userMessage: "That company name isn't available, pick another.",
        fieldErrors: { workspaceName: "Not available" },
      });
    }

    // ----- Card-first split (dashboard#785) -----
    // PAID tiers: create ONLY the Stripe customer + a SetupIntent here. No
    // Zitadel user and no Tenant CR exist until the card clears in
    // completeSignup() — an abandoned or declined signup leaves nothing behind.
    if (paidTiersEnabled()) {
      let stripeCustomerId: string;
      let cardClientSecret: string;
      try {
        stripeCustomerId = await findOrCreateSignupCustomer({
          email: ctx.input.email,
          name: ctx.input.workspaceName,
          tenantSlug: ctx.tenantSlug,
          tier: ctx.input.tier,
        });
        const intent = await createSetupIntent({
          customerId: stripeCustomerId,
          tenantSlug: ctx.tenantSlug,
          idempotencyKey: `signup:${attemptId}:setup-intent`,
        });
        if (!intent.client_secret) {
          throw new Error("SetupIntent has no client_secret");
        }
        cardClientSecret = intent.client_secret;
      } catch (err) {
        logger.error(
          {
            attemptId,
            action: "signup_setup_intent",
            err: err instanceof Error ? err.message : String(err),
          },
          "card-first phase 1 (customer + SetupIntent) failed",
        );
        return await finish(ctx, "policy", {
          code: "INTERNAL_ERROR",
          userMessage: "We couldn't start payment setup. Please try again.",
        });
      }
      logger.info(
        {
          action: "signup_card_phase",
          attemptId,
          tenantSlug: ctx.tenantSlug,
          tier: ctx.input.tier,
        },
        "card-first phase 1 complete; awaiting inline card confirmation",
      );
      return {
        ok: true,
        phase: "card",
        attemptId,
        cardClientSecret,
        stripeCustomerId,
        tenantSlug: ctx.tenantSlug,
        tier: ctx.input.tier,
      };
    }

    // ----- Autoconfirm (kind dev; paid tiers disabled) -----
    // No card step — provision the owner + create the company inline.
    // 4. Provision the founding-owner identity via the daemon Signup RPC
    //    (create-or-resume the Zitadel user, set password, send verify email).
    await advanceStep(attemptId, "create_user");
    const userResult = await provisionOwner(ctx);
    if ("fail" in userResult) {
      return await finish(ctx, "create_user", userResult.fail);
    }
    ctx.zitadelUserId = userResult.ownerUserId;

    // 5. Apply the Tenant CR, this triggers the operator saga.
    await advanceStep(attemptId, "apply_tenant");
    try {
      await applyTenant(ctx.tenantSlug, {
        displayName: ctx.input.workspaceName,
        owner: ctx.input.email,
        // input.tier is already a canonical PlanID (validated by Zod against
        // selfServeTierIds, which mirrors plans.PlanID in the operator).
        // No mapping, the operator's entitlements reconciler expects this
        // exact value; legacy free/pro/enterprise are explicitly rejected.
        tier: ctx.input.tier as TenantTier,
      });
    } catch (err) {
      return await finish(ctx, "apply_tenant", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't create your workspace. Please try again.",
      });
    }

    return await finishProvisioning(ctx);
  } catch (err) {
    // Catch-all, any uncaught exception becomes INTERNAL_ERROR.
    logger.error(
      {
        attemptId,
        action: "signup",
        err: err instanceof Error ? err.message : String(err),
      },
      "signupAction unhandled",
    );
    return await finish(ctx, "create_user", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * finishProvisioning runs the post-tenant steps shared by the kind-autoconfirm
 * path (called inline by signupAction) and the card-first path (called by
 * completeSignup once the trialing subscription is created and the Tenant CR
 * is applied): wait for status.zitadelOrgID → apply the owner TenantMember →
 * wait Active → redirect to /login → done.
 */
async function finishProvisioning(ctx: Ctx): Promise<SignupActionResult> {
  const { attemptId } = ctx;
  if (!ctx.tenantSlug) {
    // Programmer error — every caller sets tenantSlug before reaching here.
    return await finish(ctx, "setup_workspace", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
  const tenantSlug: string = ctx.tenantSlug;

  try {
    // 7. Wait for the operator to set status.zitadelOrgID.
    await advanceStep(attemptId, "setup_workspace");
    const tenant = await waitForTenantReady(tenantSlug);
    if (!tenant) {
      return await finish(ctx, "setup_workspace", {
        code: "PROVISIONING_TIMEOUT",
        userMessage:
          "Still setting up your workspace, we'll email you when it's ready.",
      });
    }
    if (tenant.status?.phase === "Failed") {
      return await finish(ctx, "setup_workspace", {
        code: "PROVISIONING_FAILED",
        userMessage:
          "Something went wrong setting up your workspace. Our team has been notified.",
      });
    }

    // 8. Apply the TenantMember CR (operator wires the user to the Zitadel org).
    await advanceStep(attemptId, "apply_member");
    try {
      await applyTenantMember(
        tenantNamespace(tenantSlug),
        `${slugify(ctx.input.email)}-owner`,
        {
          email: ctx.input.email,
          role: "owner",
          tenantRef: { name: ctx.tenantSlug },
          // Self-signup: the signup user IS the workspace owner, pre-accept the
          // membership so the operator promotes Invited → Active without
          // requiring the user to click an emailed invitation link. The
          // operator's invitation flow is for invitees, not the founding owner.
          // Spec: tenant-role-taxonomy, founding user is granted the
          // first-class `owner` FGA relation (admin/member inherit by union).
          acceptedByUserId: ctx.zitadelUserId,
        },
      );
    } catch (err) {
      logger.error(
        {
          attemptId: ctx.attemptId,
          tenantSlug: ctx.tenantSlug,
          err: err instanceof Error ? err.message : String(err),
        },
        "applyTenantMember failed",
      );
      return await finish(ctx, "apply_member", {
        code: "INTERNAL_ERROR",
        userMessage:
          "Your account was created but we couldn't add you to the workspace. Support has been notified.",
      });
    }

    // 9. Wait for the membership to become Active.
    await advanceStep(attemptId, "grant_owner_role");
    const memberReady = await waitForMemberReady(
      tenantNamespace(tenantSlug),
      `${slugify(ctx.input.email)}-owner`,
    );
    if (!memberReady) {
      return await finish(ctx, "grant_owner_role", {
        code: "MEMBERSHIP_TIMEOUT",
        userMessage:
          "Workspace created but owner-role provisioning is still in progress. Try signing in in a minute.",
      });
    }

    // 10. Done. The user has a valid Zitadel account; route through /login so
    //     Auth.js mints the dashboard session via its standard OIDC flow.
    await completeProgress(attemptId);
    logAudit("signup_ok", ctx);
    return {
      ok: true,
      attemptId,
      redirect: POST_SIGNUP_REDIRECT,
    };
  } catch (err) {
    // Catch-all, any uncaught exception becomes INTERNAL_ERROR.
    logger.error(
      {
        attemptId,
        action: "signup",
        err: err instanceof Error ? err.message : String(err),
      },
      "finishProvisioning unhandled",
    );
    return await finish(ctx, "create_user", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * completeSignup is card-first signup phase 2 (dashboard#785). The client
 * calls it after the inline Payment Element has confirmed the card (a
 * SetupIntent on the phase-1 customer). It:
 *   1. verifies the client-supplied customer really belongs to this email,
 *   2. creates the trialing subscription on the confirmed card,
 *   3. ONLY THEN provisions the owner user + Tenant CR (pinning the customer
 *      id so the operator saga adopts it deterministically),
 *   4. provisions (org wait → member → owner → /login).
 *
 * Nothing — no account, no company — exists until the card has cleared. If
 * any step before the Tenant CR fails, no CR was applied, so the company name
 * stays free and a retry reuses the same Stripe customer (reuse-by-email).
 *
 * Security: every field arrives from the client, so nothing is trusted. The
 * tier is re-validated, the slug is re-checked for availability, and the
 * customer id is verified against the email before any subscription is created
 * — a caller cannot subscribe an arbitrary customer or hijack another company.
 */
export async function completeSignup(
  input: CompleteSignupInput,
): Promise<SignupActionResult> {
  const attemptId = UUID_RE.test(input.attemptId) ? input.attemptId : randomUUID();
  const email = input.email.trim().toLowerCase();

  const ctx: Ctx = {
    attemptId,
    input: {
      email,
      password: input.password,
      workspaceName: input.workspaceName.trim(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      tier: input.tier as SignupInput["tier"],
      passwordConfirm: input.password,
      acceptToS: true,
      acceptPrivacy: true,
    },
    zitadelUserId: undefined,
    tenantSlug: input.tenantSlug,
  };

  try {
    // Re-validate the client-supplied tier + slug.
    if (!(selfServeTierIds as readonly string[]).includes(input.tier)) {
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage: "Invalid plan. Please start over.",
      });
    }
    if (!input.tenantSlug || slugify(ctx.input.workspaceName) !== input.tenantSlug) {
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage: "Your company name didn't match. Please start over.",
      });
    }
    // Slug-availability race guard: someone may have taken the name between
    // phase 1 and now. A pre-existing tenant owned by THIS email is a retry
    // (allowed — the idempotent Signup RPC + idempotent saga handle it).
    const existing = await safeGetTenant(input.tenantSlug);
    if (existing && existing.spec.owner !== email) {
      return await finish(ctx, "create_billing", {
        code: "WORKSPACE_TAKEN",
        userMessage: "That company name isn't available, pick another.",
        fieldErrors: { workspaceName: "Not available" },
      });
    }
    // Verify the (client-supplied) customer id belongs to this signup's email
    // before subscribing it.
    if (
      !input.stripeCustomerId ||
      !(await verifySignupCustomer(input.stripeCustomerId, email))
    ) {
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't verify your payment details. Please start over.",
      });
    }

    // Validate billing config up front so a misconfigured plan fails BEFORE
    // we provision any account or company.
    const priceId = priceIdForTier(input.tier);
    const trialDays = lookupPlan(input.tier as PlanID).trialDays;
    if (!priceId || !trialDays || trialDays <= 0) {
      logger.error(
        { attemptId, tier: input.tier },
        "billing misconfigured for tier (missing price or trialDays)",
      );
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage: "Billing isn't configured for that plan. Please contact support.",
      });
    }

    // 1. Provision the founding-owner identity via the daemon Signup RPC. The
    //    card is already confirmed (the phase-1 SetupIntent), so this runs only
    //    after the payment method cleared. Pin the Stripe customer id so the
    //    operator saga adopts it deterministically. (We also pass it on the
    //    Tenant CR below; the RPC stripe_customer_id is for daemon-side use.)
    await advanceStep(attemptId, "create_user");
    const userResult = await provisionOwner(ctx, input.stripeCustomerId);
    if ("fail" in userResult) {
      return await finish(ctx, "create_user", userResult.fail);
    }
    ctx.zitadelUserId = userResult.ownerUserId;

    // 2. Apply the Tenant CR BEFORE creating the subscription, pinning the
    //    pre-created Stripe customer id so the operator saga adopts it
    //    deterministically (no Stripe-search race that would mint a duplicate
    //    customer — the orphan-dupe / 21k-leak class). Applying it first also
    //    closes a webhook race: createTrialingSubscription (below) fires
    //    Stripe's subscription.created webhook, whose handler patches
    //    billing-active onto THIS Tenant CR. If the CR didn't exist yet the
    //    patch 404s and billing-active never lands within the provisioning
    //    window, timing out the signup (dashboard#785).
    await advanceStep(attemptId, "apply_tenant");
    try {
      await applyTenant(
        input.tenantSlug,
        {
          displayName: ctx.input.workspaceName,
          owner: email,
          tier: input.tier as TenantTier,
        },
        { stripeCustomerId: input.stripeCustomerId },
      );
    } catch (err) {
      return await finish(ctx, "apply_tenant", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't create your workspace. Please try again.",
      });
    }

    // 3. Create the trialing subscription. Its subscription.created webhook now
    //    finds the Tenant CR (applied above) and stamps billing-active,
    //    releasing the operator's WaitForBillingConfirmation step.
    await advanceStep(attemptId, "create_billing");
    try {
      await createTrialingSubscription({
        tier: input.tier as BillingTier,
        priceId,
        customerId: input.stripeCustomerId,
        paymentMethodId: input.paymentMethodId,
        trialPeriodDays: trialDays,
        tenantSlug: input.tenantSlug,
        // One subscription per signup attempt; tolerates retries.
        idempotencyKey: `signup:${attemptId}:subscription`,
      });
    } catch (err) {
      logger.error(
        {
          attemptId,
          action: "signup_subscription",
          err: err instanceof Error ? err.message : String(err),
        },
        "createTrialingSubscription failed",
      );
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage:
          "We couldn't start your subscription and your card was not charged. Please try again.",
      });
    }
    // The customer now belongs to this tenant; drop the reuse tag so a later
    // unrelated signup with the same email never reuses it (best-effort).
    await finalizeSignupCustomer(input.stripeCustomerId);

    // 4. Finish provisioning (org wait → member → owner → /login).
    return await finishProvisioning(ctx);
  } catch (err) {
    logger.error(
      {
        attemptId,
        action: "signup_complete",
        err: err instanceof Error ? err.message : String(err),
      },
      "completeSignup unhandled",
    );
    return await finish(ctx, "create_billing", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * paidTiersEnabled mirrors the dashboard billing master switch via the single
 * source of truth (billingEnabled / DASHBOARD_BILLING_PAID_TIERS_ENABLED).
 * When off (on-prem / kind dev), signup runs the autoconfirm path with no
 * card step.
 */
function paidTiersEnabled(): boolean {
  return billingEnabled();
}

// ---------------------------------------------------------------------------
// Pipeline context + finish helper
// ---------------------------------------------------------------------------

interface Ctx {
  attemptId: string;
  input: SignupInput;
  zitadelUserId: string | undefined;
  tenantSlug: string | undefined;
}

interface FinishFailure {
  code: SignupFailureCode;
  userMessage: string;
  fieldErrors?: Partial<Record<keyof SignupInput, string>>;
}

async function finish(
  ctx: Ctx,
  atStep: ProvisioningStep,
  failure: FinishFailure,
): Promise<SignupActionResult> {
  await failProgress(ctx.attemptId, atStep, failure.code, failure.userMessage);
  logAudit("signup_fail", ctx, failure.code);
  return {
    ok: false,
    attemptId: ctx.attemptId,
    code: failure.code,
    userMessage: failure.userMessage,
    fieldErrors: failure.fieldErrors,
  };
}

function logAudit(
  outcome: "signup_ok" | "signup_fail",
  ctx: Ctx,
  failureCode?: SignupFailureCode,
): void {
  logger.info(
    {
      action: "signup",
      outcome,
      attemptId: ctx.attemptId,
      email: ctx.input.email,
      tenantSlug: ctx.tenantSlug,
      zitadelUserId: ctx.zitadelUserId,
      tier: ctx.input.tier,
      failureCode: failureCode ?? null,
    },
    "signup completed",
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveClientIp(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown"
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

async function safeGetTenant(name: string): Promise<Tenant | null> {
  try {
    return await getTenant(name);
  } catch (err) {
    if (err instanceof Error && /not.?found|404/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}

function checkPasswordAgainstPolicy(
  pw: string,
  policy: PasswordPolicy,
): string | null {
  if (pw.length < policy.minLength) {
    return `Password must be at least ${policy.minLength} characters.`;
  }
  if (policy.hasUppercase && !/[A-Z]/.test(pw)) {
    return "Password must contain an uppercase letter.";
  }
  if (policy.hasLowercase && !/[a-z]/.test(pw)) {
    return "Password must contain a lowercase letter.";
  }
  if (policy.hasNumber && !/\d/.test(pw)) {
    return "Password must contain a number.";
  }
  if (policy.hasSymbol && !/[^A-Za-z0-9]/.test(pw)) {
    return "Password must contain a symbol.";
  }
  return null;
}

/**
 * Provision (or resume) the founding-owner identity via the daemon
 * SignupService.Signup RPC. The daemon performs the IdP-admin create-or-resume
 * user, set-password, and best-effort verification-email; the dashboard holds
 * no Zitadel admin credential (E9, dashboard#812).
 *
 * Maps RPC failures to user-safe signup failure codes: a daemon-side password
 * policy rejection (InvalidArgument / FailedPrecondition) surfaces as
 * POLICY_VIOLATION; Unavailable as ZITADEL_UNAVAILABLE; anything else as
 * INTERNAL_ERROR.
 */
async function provisionOwner(
  ctx: Ctx,
  stripeCustomerId?: string,
): Promise<{ ownerUserId: string; alreadyExisted: boolean } | { fail: FinishFailure }> {
  try {
    const result = await provisionSignupOwner({
      attemptId: ctx.attemptId,
      ownerEmail: ctx.input.email,
      workspaceName: ctx.input.workspaceName,
      tier: ctx.input.tier,
      ownerFirstName: ctx.input.firstName,
      ownerLastName: ctx.input.lastName,
      stripeCustomerId,
      password: ctx.input.password,
    });
    return { ownerUserId: result.ownerUserId, alreadyExisted: result.alreadyExisted };
  } catch (err) {
    const code = err instanceof ConnectError ? err.code : undefined;
    const rawMessage = err instanceof ConnectError ? err.rawMessage : "";

    if (
      code === Code.InvalidArgument ||
      code === Code.FailedPrecondition ||
      /password|complexity/i.test(rawMessage)
    ) {
      const msg = /password|complexity/i.test(rawMessage)
        ? "Password doesn't meet the policy."
        : "We couldn't process your signup details. Please check them and try again.";
      return {
        fail: {
          code: "POLICY_VIOLATION",
          userMessage: msg,
          fieldErrors: /password|complexity/i.test(rawMessage)
            ? { password: "Password doesn't meet the policy." }
            : undefined,
        },
      };
    }
    if (code === Code.Unavailable || code === Code.DeadlineExceeded) {
      return {
        fail: {
          code: "ZITADEL_UNAVAILABLE",
          userMessage:
            "We're having trouble reaching our identity service. Try again in a moment.",
        },
      };
    }
    logger.error(
      {
        attemptId: ctx.attemptId,
        action: "signup_provision_owner",
        connectCode: code,
        err: err instanceof Error ? err.message : String(err),
      },
      "owner provisioning RPC failed",
    );
    return {
      fail: {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't create your account. Please try again.",
      },
    };
  }
}

async function waitForTenantReady(name: string): Promise<Tenant | null> {
  const deadline = Date.now() + TENANT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const t = await getTenant(name);
      if (t.status?.zitadelOrgID) {
        return t;
      }
      if (t.status?.phase === "Failed") {
        return t;
      }
    } catch {
      // CR may not exist yet on the very first poll, retry.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function waitForMemberReady(
  namespace: string,
  name: string,
): Promise<boolean> {
  const deadline = Date.now() + MEMBER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const m = await k8s().get<TenantMember>("TenantMember", name, namespace);
      if (m.status?.phase === "Active") {
        return true;
      }
    } catch {
      // Not yet created, retry.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
