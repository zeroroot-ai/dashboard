"use server";

/**
 * @server-action-authz-exempt: pre-authentication, signup runs before any
 * session or tenant exists; it is the action that creates them. Abuse is
 * gated by CAPTCHA + email-nonce, not session authz.
 *
 * signupAction, the dashboard-native signup pipeline.
 *
 * A single linear orchestration: form input → daemon owner provisioning (which
 * also enqueues the tenant for operator-pull provisioning) → operator creates
 * the Tenant CR + runs the saga (including the founding-owner TenantMember,
 * gibson#958) → redirect to /login. Each step emits progress to the daemon
 * signup-progress store for the client-side ProvisioningPanel to poll; each
 * failure short-circuits and maps to a user-safe `SignupFailureCode`.
 *
 * Owner-user provisioning (create-or-resume the Zitadel human user, set
 * password, send verification email) runs DAEMON-SIDE via the unauthenticated
 * `gibson.tenant.v1.SignupService.Signup` RPC (gibson#812). That same RPC now
 * enqueues a pending-tenant-provisioning row (gibson#949); the tenant-operator
 * polls it (leader-elected, ~15s) and creates the Tenant CR — the dashboard no
 * longer writes the Tenant CR itself (dashboard#813, ADR-0023 preserved). The
 * dashboard no longer holds a privileged Zitadel signup-bot PAT (dashboard#812
 * / E9). The operator owns the rest: per-tenant Zitadel org + FGA tuples +
 * Langfuse/Stripe/Redis/Neo4j init all happen downstream of the Tenant CR it
 * creates. This action stays focused on:
 *   (1) provisioning the founding-owner identity via the daemon RPC (which
 *       enqueues the tenant for the operator to create),
 *   (2) polling the daemon's operator-reported provisioning status until the
 *       workspace is Ready (the operator now creates the founding-owner
 *       TenantMember itself, gibson#958 — the dashboard no longer writes it),
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
  getTenantProvisioningStatus,
  type TenantProvisioningStatus,
} from "@/src/lib/gibson-client/provisioning";
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
import { logger } from "@/src/lib/logger";


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How long to wait for Tenant.status.zitadelOrgID to appear. The Tenant CR is
 * now created asynchronously by the tenant-operator, which polls the daemon
 * pending-provisioning queue every ~15s (gibson#949), so the budget covers both
 * the operator-poll latency (CR creation) AND the saga's org-creation step.
 * Exceeding it is non-fatal — the client ProvisioningPanel keeps polling the
 * progress store and the user is emailed when the workspace is ready.
 */
const TENANT_READY_TIMEOUT_MS = 90_000;
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
    if (await tenantExists(ctx.tenantSlug)) {
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
    //    The Signup RPC also enqueues the tenant for operator-pull
    //    provisioning (gibson#949): the tenant-operator polls the daemon's
    //    pending-provisioning queue and creates the Tenant CR + runs the saga.
    //    The dashboard no longer writes the Tenant CR (dashboard#813).
    await advanceStep(attemptId, "create_user");
    const userResult = await provisionOwner(ctx);
    if ("fail" in userResult) {
      return await finish(ctx, "create_user", userResult.fail);
    }
    ctx.zitadelUserId = userResult.ownerUserId;

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
 * completeSignup once the trialing subscription is created): poll the daemon's
 * operator-reported provisioning status until the workspace is Ready (org
 * created + founding-owner TenantMember wired by the operator, gibson#958) →
 * redirect to /login → done.
 *
 * The Tenant CR is created asynchronously by the tenant-operator (it polls the
 * daemon pending-provisioning queue every ~15s, gibson#949), so the workspace
 * does NOT exist the instant the Signup RPC returns. `waitForTenantReady`
 * tolerates this — it polls `GetTenantProvisioningStatus` (the operator-reported
 * status mirror, dashboard#813/#855) and treats `found:false` (no record yet) as
 * still-provisioning until the operator has reported the per-tenant Zitadel org
 * slug. A wait that exceeds the timeout returns a NON-fatal PROVISIONING_TIMEOUT
 * ("we'll email you"); the client-side ProvisioningPanel keeps polling the
 * progress store, so the user is never sent into a workspace that isn't ready.
 *
 * The dashboard no longer writes the founding-owner TenantMember CR (the last
 * remaining K8s write in signup): the tenant-operator creates it as part of the
 * provisioning saga (name `<slugify(owner_email)>-owner`, owner role,
 * pre-accepted via the owner's Zitadel sub; gibson#958). Member-readiness is
 * therefore folded into the tenant-Ready signal the status mirror reports — the
 * operator only reaches phase `Ready` after the founding member is wired — so
 * there is no separate TenantMember poll.
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
    // 7. Wait for the operator to provision the workspace. `waitForTenantReady`
    //    polls the daemon's operator-reported status mirror until the per-tenant
    //    Zitadel org slug appears (org created) — which the operator only
    //    reports once the saga, including the founding-owner TenantMember
    //    (gibson#958), has progressed. The dashboard no longer writes the
    //    TenantMember itself (dashboard#855): the operator owns it, so
    //    member-readiness is subsumed by this single tenant-Ready signal.
    await advanceStep(attemptId, "setup_workspace");
    const status = await waitForTenantReady(tenantSlug);
    if (!status) {
      return await finish(ctx, "setup_workspace", {
        code: "PROVISIONING_TIMEOUT",
        userMessage:
          "Still setting up your workspace, we'll email you when it's ready.",
      });
    }
    if (status.phase === "Failed") {
      return await finish(ctx, "setup_workspace", {
        code: "PROVISIONING_FAILED",
        userMessage:
          "Something went wrong setting up your workspace. Our team has been notified.",
      });
    }

    // 8. Done. The user has a valid Zitadel account; route through /login so
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
    // (allowed); one owned by a DIFFERENT email must be blocked.
    //
    // Post-dashboard#813 the dashboard holds no Kubernetes access, so it can no
    // longer read the Tenant CR's spec.owner to distinguish "owned by me
    // (retry)" from "owned by someone else (blocked)". The daemon
    // GetTenantProvisioningStatus reports `found` but not the owner email, so we
    // cannot disambiguate here. Rather than block legitimate retries (which
    // would `found:true` just the same), we drop the pre-check and rely on the
    // two independent guarantees that already hold:
    //   - verifySignupCustomer (below) blocks customer hijack, so a caller can
    //     never subscribe a customer that isn't theirs;
    //   - the daemon SignupService.Signup RPC is idempotent on owner email and
    //     the operator saga reconciles idempotently keyed by zitadel_sub, so a
    //     genuine retry resumes the same owner/tenant and a name collision by a
    //     different owner is rejected daemon-side at owner-provisioning time
    //     (surfaced as an INTERNAL_ERROR / WORKSPACE_TAKEN below).
    // The earlier signupAction availability probe (GetTenantProvisioningStatus
    // `found`) remains the primary inline "name taken" signal for the user.

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
    //    after the payment method cleared. The RPC's stripe_customer_id pins the
    //    pre-created Stripe customer id onto the enqueued pending-provisioning
    //    row (gibson#949); the tenant-operator stamps it onto the Tenant CR it
    //    creates, so the saga's CreateStripeCustomer step adopts it
    //    deterministically (no Stripe-search race that would mint a duplicate
    //    customer — the orphan-dupe / 21k-leak class, to#354). The dashboard no
    //    longer writes the Tenant CR itself (dashboard#813).
    await advanceStep(attemptId, "create_user");
    const userResult = await provisionOwner(ctx, input.stripeCustomerId);
    if ("fail" in userResult) {
      return await finish(ctx, "create_user", userResult.fail);
    }
    ctx.zitadelUserId = userResult.ownerUserId;

    // 2. Create the trialing subscription. Its subscription.created webhook
    //    stamps billing-active onto the Tenant CR, releasing the operator's
    //    WaitForBillingConfirmation step. The Tenant CR is now created
    //    asynchronously by the operator (~15s after the enqueue above), so the
    //    webhook's patch may briefly 404; the webhook returns 500 in that case
    //    and Stripe retries with backoff until the operator has created the CR
    //    (the webhook idempotency record is dropped on failure so the retry
    //    re-runs the patch). This replaces the old "apply CR before subscribe"
    //    ordering, which relied on the dashboard's synchronous CR write.
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

/**
 * tenantExists is the slug-availability check: it returns true when the daemon's
 * operator-reported status mirror has a record for the slug (`found`). This
 * replaces the prior `safeGetTenant(slug) !== null` existence probe — `found`
 * doubles as the slug-availability signal (gibson#952, dashboard#855). A
 * transport error degrades to "not taken" so the signup can still proceed; the
 * Signup RPC + saga are idempotent on owner email and the admission webhook is
 * the authoritative gate.
 */
async function tenantExists(slug: string): Promise<boolean> {
  try {
    const status = await getTenantProvisioningStatus(slug);
    return status.found;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), slug },
      "tenant-exists check failed (degrading to not-taken)",
    );
    return false;
  }
}

/**
 * waitForTenantReady polls the daemon's operator-reported provisioning status
 * mirror (gibson#952, dashboard#855) until the workspace is ready or the timeout
 * elapses. Readiness is signalled by the per-tenant Zitadel org slug appearing
 * (the operator only reports it once the org is created and the saga — including
 * the founding-owner TenantMember, gibson#958 — has progressed), or a terminal
 * `Failed` phase. `found:false` (no record yet) and an empty org slug are both
 * "still provisioning, keep polling". Returns the final status, or null on
 * timeout (non-fatal — the client keeps polling the progress store).
 */
async function waitForTenantReady(
  slug: string,
): Promise<TenantProvisioningStatus | null> {
  const deadline = Date.now() + TENANT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const status = await getTenantProvisioningStatus(slug);
      if (status.found) {
        if (status.zitadelOrgSlug || status.phase === "Ready") {
          return status;
        }
        if (status.phase === "Failed") {
          return status;
        }
      }
    } catch {
      // Status record may not exist yet on the very first poll, retry.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
