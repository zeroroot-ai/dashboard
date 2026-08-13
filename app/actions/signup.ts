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

import { cookies } from "next/headers";
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
  finalizeSignupCustomer,
  verifySignupCustomer,
  createSetupIntent,
  createTrialingSubscription,
  priceIdForTier,
  type BillingTier,
} from "@/src/lib/billing/stripe";
import { billingEnabled } from "@/src/lib/billing/billing-enabled";
import { lookupPlan, type PlanID } from "@/src/generated/plans";
import {
  requestSignupVerification,
  attachSignupCustomer,
  completeSignupOwner,
} from "@/src/lib/signup/owner-provisioning";
import { assertPasswordNotBreached } from "@/src/lib/auth/breached-password-gate";
import { resolveClientIp } from "@/src/lib/signup/client-ip";
import {
  SIGNUP_VERIFIED_COOKIE,
  SIGNUP_VERIFIED_MAX_AGE_SECONDS,
  decodeVerifiedSession,
  encodeVerifiedSession,
  signupCookieOptions,
  type VerifiedSignupSession,
} from "@/src/lib/signup/verified-session";
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
 * the operator-poll latency (CR creation) AND the full provisioning saga.
 * Exceeding it is non-fatal — the client ProvisioningPanel stays on the
 * "still working" holding state and the user is emailed when the workspace is
 * ready.
 *
 * Budget (dashboard#962): 240s. A second back-to-back tenant provision was
 * observed at 2m25s CR→Ready on floor-sized staging (the saga's data-plane
 * steps queue behind the first tenant's; the Neo4j step alone has a 2-minute
 * operator-side timeout), plus ≤15s queue pickup ≈ 160s realistic worst case;
 * the signup smoke's own saga budget is 180s. The previous 90s was tighter
 * than real second-tenant latency and failed the signup while the tenant
 * still reached Ready.
 *
 * Chain invariant (same failure class as deploy#1020): every HTTP hop above
 * this wait must exceed the worst-case action duration (~255s = 240s wait +
 * Stripe/owner-provisioning preamble). Envoy's app-vhost catch-all route
 * timeout is 300s (deploy helm/gibson-workloads/files/envoy/envoy.yaml) and
 * the staging NLB TCP idle timeout is a fixed 350s:
 *   NLB 350s > Envoy 300s > action ~255s > TENANT_READY_TIMEOUT_MS 240s.
 * If you raise this, raise the Envoy route timeout in the same change set.
 */
const TENANT_READY_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Post-signup destination. Routes through /login so the LoginForm client
 * component invokes Auth.js v5's CSRF-protected signIn("zitadel"), which
 * POSTs to /api/auth/signin/zitadel with the required tokens.
 *
 * The auto-login path (issue dashboard#41) is retired in E9 (dashboard#812):
 * it depended on a broad signup-bot Zitadel PAT holding IAM_LOGIN_CLIENT.
 * That grant DID land once (gitops#90, merged via gitops PR #92 as commit
 * 2dd4167, 2026-05-14) but regressed out in the later apps/manifests ->
 * envs/ overlay restructure; no IAM_LOGIN_CLIENT grant exists on gitops
 * main today, so auto-login already fell back to /login at runtime.
 * Restoring it via a narrow login-scoped credential is tracked in
 * dashboard#853; until then /login is the single post-signup path.
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
   * Optional client-supplied attempt id. The form mints this so the same id
   * survives the mail round-trip and the progress stream can be resumed on the
   * completion screen. Server validates the format defensively.
   */
  clientAttemptId?: string,
): Promise<SignupActionResult> {
  const attemptId =
    clientAttemptId && UUID_RE.test(clientAttemptId)
      ? clientAttemptId
      : randomUUID();

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

    // Normalize email to lowercase + trim. The daemon normalizes again and its
    // value is the authoritative one; this keeps the local rate-limit key and
    // the daemon's per-address budget keyed on the same string.
    ctx.input = {
      ...ctx.input,
      email: ctx.input.email.trim().toLowerCase(),
      firstName: ctx.input.firstName.trim(),
      lastName: ctx.input.lastName.trim(),
      workspaceName: ctx.input.workspaceName.trim(),
    };

    // 1. Rate limit. A cheap early reject only — the control that binds is the
    //    daemon's, inside the RPC handler, which no caller can route around.
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

    // 2. Workspace-name availability. Advisory: the admission webhook is the
    //    authoritative gate and the daemon re-derives the slug at completion.
    ctx.tenantSlug = slugify(ctx.input.workspaceName);
    if (!ctx.tenantSlug) {
      return await finish(ctx, "policy", {
        // dashboard#44: user-visible copy uses "company name"; the internal
        // code, error code, and field name stay as workspaceName /
        // WORKSPACE_TAKEN to avoid moving downstream wiring.
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

    // 3. Ask the daemon to email a verification link. THIS IS THE WHOLE STEP.
    //
    //    No Zitadel user, no Stripe customer, no SetupIntent, no Tenant CR. The
    //    previous shape created a billing customer and a SetupIntent right here,
    //    before anyone had shown they could receive mail at the address — which
    //    meant an anonymous request left a billing object behind for an address
    //    that might belong to someone else entirely.
    await advanceStep(attemptId, "send_verify_email");
    try {
      await requestSignupVerification({
        attemptId,
        ownerEmail: ctx.input.email,
        workspaceName: ctx.input.workspaceName,
        tier: ctx.input.tier,
        ownerFirstName: ctx.input.firstName,
        ownerLastName: ctx.input.lastName,
        clientIp: ip,
      });
    } catch (err) {
      return await finish(ctx, "send_verify_email", mapVerificationError(err));
    }

    logger.info(
      { action: "signup_verification_requested", attemptId, tier: ctx.input.tier },
      "verification requested; nothing provisioned",
    );
    return { ok: true, phase: "verify_email", attemptId };
  } catch (err) {
    logger.error(
      {
        attemptId,
        action: "signup",
        err: err instanceof Error ? err.message : String(err),
      },
      "signupAction unhandled",
    );
    return await finish(ctx, "send_verify_email", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * startSignupPayment is the paid path's FIRST billing call, and it cannot run
 * before this point in the flow.
 *
 * It reads the verified-session cookie, which only exists because the emailed
 * link was redeemed. Then, and only then, it creates the Stripe customer and a
 * SetupIntent, and pins the customer to the session daemon-side so the
 * completion call does not have to be trusted for it.
 *
 * On the card-free profile (self-hosted / paid tiers disabled) it is a no-op
 * that reports no client secret; the completion screen renders without a card.
 */
export async function startSignupPayment(): Promise<SignupActionResult> {
  const session = await readVerifiedSession();
  if (!session) {
    return {
      ok: false,
      attemptId: "",
      code: "VERIFICATION_INVALID",
      userMessage: "That link is no longer valid. Please start again.",
    };
  }
  if (!paidTiersEnabled()) {
    return { ok: true, phase: "card", attemptId: session.attemptId, cardClientSecret: "" };
  }

  const tenantSlug = slugify(session.workspaceName);
  try {
    const stripeCustomerId = await findOrCreateSignupCustomer({
      email: session.email,
      name: session.workspaceName,
      tenantSlug,
      tier: session.tier,
    });
    const intent = await createSetupIntent({
      customerId: stripeCustomerId,
      tenantSlug,
      idempotencyKey: `signup:${session.attemptId}:setup-intent`,
    });
    if (!intent.client_secret) {
      throw new Error("SetupIntent has no client_secret");
    }
    // Pin it daemon-side BEFORE handing the card form to the browser, so the
    // completion call never carries a customer id the daemon has to trust.
    await attachSignupCustomer({
      verifiedSessionToken: session.verifiedSessionToken,
      stripeCustomerId,
      clientIp: await resolveClientIp(),
    });
    await writeVerifiedSession({ ...session, stripeCustomerId });
    return {
      ok: true,
      phase: "card",
      attemptId: session.attemptId,
      cardClientSecret: intent.client_secret,
    };
  } catch (err) {
    logger.error(
      {
        attemptId: session.attemptId,
        action: "signup_setup_intent",
        err: err instanceof Error ? err.message : String(err),
      },
      "payment setup failed after verification",
    );
    return {
      ok: false,
      attemptId: session.attemptId,
      code: "INTERNAL_ERROR",
      userMessage: "We couldn't start payment setup. Please try again.",
    };
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
    //    polls the daemon's operator-reported status mirror until
    //    `zitadelOrgReady` goes true (org created) — which the operator only
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
 * completeSignup finishes a VERIFIED signup.
 *
 * Its authority is the verified-session cookie and nothing else. Note what it
 * does not accept from the caller: no email, no company name, no plan, no
 * customer id. All of those are read daemon-side from the verification row the
 * session resolves to, so a caller who redeemed a link for one address cannot
 * provision a workspace for another. The only inputs are the password the user
 * just typed and, on the paid path, the payment method they just confirmed.
 *
 * Order:
 *   0. Refuse a known-breached password, before anything at all exists.
 *   1. Create the founding-owner identity and enqueue the tenant (the daemon
 *      consumes the session here, so it cannot be replayed into a second
 *      workspace).
 *   2. Create the trialing subscription on the already-confirmed card.
 *   3. Poll provisioning to Ready and hand back the /login redirect.
 */
export async function completeSignup(
  input: CompleteSignupInput,
): Promise<SignupActionResult> {
  const session = await readVerifiedSession();
  if (!session) {
    return {
      ok: false,
      attemptId: "",
      code: "VERIFICATION_INVALID",
      userMessage: "That link is no longer valid. Please start again.",
    };
  }

  // Breached-password gate, FIRST. This is the only point in the flow where
  // the password exists, and it runs before the identity, the tenant, the
  // billing customer's subscription — before anything a refusal would have to
  // be rolled back from. A rejected attempt leaves the verified session live
  // so the user simply picks another password on the same screen.
  //
  // Fail-open on an unreachable HIBP: see assertPasswordNotBreached.
  const breach = await assertPasswordNotBreached(
    input.password,
    "signup",
    session.email,
  );
  if (!breach.allowed) {
    return {
      ok: false,
      attemptId: session.attemptId,
      // COPY REVIEW: new string on a path that was unreachable until now.
      code: "POLICY_VIOLATION",
      userMessage:
        "That password has appeared in a data breach. Please choose a different one.",
      fieldErrors: {
        password:
          "That password has appeared in a data breach. Please choose a different one.",
      },
    };
  }

  const ctx: Ctx = {
    attemptId: session.attemptId,
    input: {
      email: session.email,
      workspaceName: session.workspaceName,
      firstName: "",
      lastName: "",
      tier: session.tier as SignupInput["tier"],
      acceptToS: true,
      acceptPrivacy: true,
    },
    zitadelUserId: undefined,
    tenantSlug: slugify(session.workspaceName),
  };

  try {
    const paid = paidTiersEnabled();
    if (paid && (!input.paymentMethodId || !session.stripeCustomerId)) {
      return await finish(ctx, "create_billing", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't verify your payment details. Please start over.",
      });
    }

    // The customer id rides in the session cookie, and a cookie is a value the
    // browser holds: someone with a valid session of their own can put another
    // account's customer id in it and have us subscribe a card to a stranger's
    // billing record. The daemon pinned this customer to the verification row
    // but does not hand it back, so the cookie is what we have — confirm it
    // still belongs to the address this session proved before subscribing it.
    // Checked before the account is created so a rejection leaves nothing
    // behind.
    if (paid && session.stripeCustomerId) {
      if (!(await verifySignupCustomer(session.stripeCustomerId, session.email))) {
        logger.error(
          { attemptId: ctx.attemptId, action: "signup_customer_mismatch" },
          "session customer does not belong to the verified address",
        );
        return await finish(ctx, "create_billing", {
          code: "INTERNAL_ERROR",
          userMessage: "We couldn't verify your payment details. Please start over.",
        });
      }
    }

    // Validate billing config BEFORE creating the account, so a misconfigured
    // plan does not leave a user with an identity and no subscription.
    let priceId: string | null = null;
    let trialDays: number | undefined;
    if (paid) {
      priceId = await priceIdForTier(session.tier);
      trialDays = lookupPlan(session.tier as PlanID).trialDays;
      if (!priceId || !trialDays || trialDays <= 0) {
        logger.error(
          { attemptId: ctx.attemptId, tier: session.tier },
          "billing misconfigured for tier (missing price or trialDays)",
        );
        return await finish(ctx, "create_billing", {
          code: "INTERNAL_ERROR",
          userMessage:
            "Billing isn't configured for that plan. Please contact support.",
        });
      }
    }

    // 1. Create the founding-owner identity + enqueue the tenant. The daemon
    //    reads the address, company name, plan and customer id from its own
    //    verification row; this call supplies only the session and the password.
    await advanceStep(ctx.attemptId, "create_user");
    const clientIp = await resolveClientIp();
    let ownerUserId: string;
    try {
      const result = await completeSignupOwner({
        attemptId: ctx.attemptId,
        verifiedSessionToken: session.verifiedSessionToken,
        password: input.password,
        clientIp,
      });
      ownerUserId = result.ownerUserId;
      ctx.tenantSlug = result.tenantId;
    } catch (err) {
      return await finish(ctx, "create_user", mapCompletionError(err));
    }
    ctx.zitadelUserId = ownerUserId;

    // 2. Create the trialing subscription on the confirmed card.
    if (paid && priceId && trialDays && session.stripeCustomerId && input.paymentMethodId) {
      await advanceStep(ctx.attemptId, "create_billing");
      try {
        await createTrialingSubscription({
          tier: session.tier as BillingTier,
          priceId,
          customerId: session.stripeCustomerId,
          paymentMethodId: input.paymentMethodId,
          trialPeriodDays: trialDays,
          tenantSlug: ctx.tenantSlug ?? "",
          // One subscription per signup attempt; tolerates retries.
          idempotencyKey: `signup:${ctx.attemptId}:subscription`,
        });
      } catch (err) {
        logger.error(
          {
            attemptId: ctx.attemptId,
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
      await finalizeSignupCustomer(session.stripeCustomerId);
    }

    // The session is spent daemon-side; drop the cookie so a stale one cannot
    // send the user back into a completion that can no longer succeed.
    await clearVerifiedSession();

    // 3. Finish provisioning (wait for Ready → /login).
    return await finishProvisioning(ctx);
  } catch (err) {
    logger.error(
      {
        attemptId: ctx.attemptId,
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
  fieldErrors?: Partial<Record<string, string>>;
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

/**
 * readVerifiedSession / writeVerifiedSession / clearVerifiedSession — the
 * completion capability, in an httpOnly cookie.
 *
 * Every post-redemption action reads the session from here rather than taking
 * it as an argument. A session passed as an argument is a session the caller
 * chooses; a session read from an httpOnly cookie is one the browser cannot
 * read, forge, or move to another tab's signup.
 */
async function readVerifiedSession(): Promise<VerifiedSignupSession | null> {
  const jar = await cookies();
  return decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);
}

async function writeVerifiedSession(s: VerifiedSignupSession): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: SIGNUP_VERIFIED_COOKIE,
    value: encodeVerifiedSession(s),
    maxAge: SIGNUP_VERIFIED_MAX_AGE_SECONDS,
    ...signupCookieOptions(),
  });
}

async function clearVerifiedSession(): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: SIGNUP_VERIFIED_COOKIE,
    value: "",
    maxAge: 0,
    ...signupCookieOptions(),
  });
}

/**
 * mapVerificationError turns a RequestEmailVerification failure into a
 * user-safe code.
 *
 * It must NOT distinguish outcomes the daemon deliberately made identical. The
 * daemon answers "this address already has an account" with exactly the same
 * empty success as "this address is new"; the only errors it raises are ones
 * decidable without consulting the directory.
 */
function mapVerificationError(err: unknown): FinishFailure {
  const code = err instanceof ConnectError ? err.code : undefined;
  if (code === Code.ResourceExhausted) {
    return {
      code: "RATE_LIMITED",
      userMessage: "Too many signup requests. Please try again later.",
    };
  }
  if (code === Code.InvalidArgument) {
    return {
      code: "POLICY_VIOLATION",
      userMessage:
        "We couldn't process your signup details. Please check them and try again.",
    };
  }
  if (code === Code.PermissionDenied) {
    // Self-serve signup is off on this deployment (admin-provision only).
    return {
      code: "INTERNAL_ERROR",
      userMessage:
        "Self-serve signup isn't available here. Please contact your administrator.",
    };
  }
  return {
    code: "ZITADEL_UNAVAILABLE",
    userMessage: "We couldn't send your verification email. Please try again.",
  };
}

/**
 * mapCompletionError turns a Signup failure into a user-safe code.
 *
 * `AlreadyExists` is surfaced honestly here and ONLY here: by this point the
 * caller has proven control of the mailbox, so telling them an account already
 * exists for it discloses nothing they are not entitled to know. At request
 * time the same fact is withheld.
 */
function mapCompletionError(err: unknown): FinishFailure {
  const code = err instanceof ConnectError ? err.code : undefined;
  const rawMessage = err instanceof ConnectError ? err.rawMessage : "";

  if (code === Code.PermissionDenied) {
    return {
      code: "VERIFICATION_INVALID",
      userMessage: "That link is no longer valid. Please start again.",
    };
  }
  if (code === Code.AlreadyExists) {
    return {
      code: "ALREADY_PROVISIONED",
      userMessage:
        "An account already exists for that email address. Please sign in instead.",
    };
  }
  if (
    code === Code.InvalidArgument ||
    code === Code.FailedPrecondition ||
    /password|complexity/i.test(rawMessage)
  ) {
    const isPolicy = /password|complexity/i.test(rawMessage);
    return {
      code: "POLICY_VIOLATION",
      userMessage: isPolicy
        ? "Password doesn't meet the policy."
        : "We couldn't process your signup details. Please check them and try again.",
      fieldErrors: isPolicy
        ? { password: "Password doesn't meet the policy." }
        : undefined,
    };
  }
  if (code === Code.Unavailable || code === Code.DeadlineExceeded) {
    return {
      code: "ZITADEL_UNAVAILABLE",
      userMessage:
        "We're having trouble reaching our identity service. Try again in a moment.",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    userMessage: "We couldn't create your account. Please try again.",
  };
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
 * elapses. Readiness is signalled by `zitadel_org_ready` going true (the operator
 * only reports it once the org is created and the saga — including the
 * founding-owner TenantMember, gibson#958 — has progressed), or a terminal
 * `Failed` phase. `found:false` (no record yet) and `zitadelOrgReady:false` are
 * both "still provisioning, keep polling". Returns the final status, or null on
 * timeout (non-fatal — the client keeps polling the progress store).
 *
 * Reads `zitadelOrgReady`, not the org slug: the daemon withholds the slug
 * itself from any caller whose authenticated tenant isn't the tenant being read
 * (gibson#1230), and this poller runs pre-membership with no tenant claim at all,
 * so the slug could never arrive here. `TenantProvisioningStatus` no longer
 * exposes it (dashboard#1016); `zitadelOrgReady` is the same readiness edge
 * without the redacted identifier (gibson#1333).
 */
async function waitForTenantReady(
  slug: string,
): Promise<TenantProvisioningStatus | null> {
  const deadline = Date.now() + TENANT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const status = await getTenantProvisioningStatus(slug);
      if (status.found) {
        if (status.zitadelOrgReady || status.phase === "Ready") {
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
