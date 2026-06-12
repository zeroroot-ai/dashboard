"use server";

/**
 * @server-action-authz-exempt: pre-authentication, signup runs before any
 * session or tenant exists; it is the action that creates them. Abuse is
 * gated by CAPTCHA + email-nonce, not session authz.
 *
 * signupAction, the dashboard-native signup pipeline.
 *
 * A single linear orchestration: form input → Zitadel user → Tenant CR →
 * operator saga → TenantMember CR → redirect to OIDC. Each step emits
 * progress to Redis for the client-side ProvisioningPanel to poll; each
 * failure short-circuits and maps to a user-safe `SignupFailureCode`.
 *
 * The operator owns the heavy lifting once the Tenant CR is applied -
 * Zitadel org + FGA tuples + Langfuse/Stripe/Redis/Neo4j init all happen
 * downstream. This action stays focused on:
 *   (1) creating the Zitadel human user,
 *   (2) applying the CRs that trigger the saga,
 *   (3) surfacing saga status back to the user as progress.
 *
 * The caller is always redirected through Zitadel's standard OIDC flow for
 * sign-in, this action never mints a dashboard session. Zitadel remains
 * the single source of truth for authenticated identity.
 *
 * Spec: dashboard-native-signup, task 13.
 */

import "server-only";

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import {
  signupInputSchema,
  type SignupInput,
  type SignupActionResult,
  type SignupResumeInput,
  type SignupFailureCode,
  type ProvisioningStep,
} from "@/app/(public)/signup/types";
import { getSignupZitadelAdminClient } from "@/src/lib/zitadel/admin-client-factory";
import { getCachedPasswordPolicy } from "@/src/lib/zitadel/password-policy-cache";
import { ZitadelApiError } from "@/src/lib/zitadel/errors";
import type {
  PasswordPolicy,
  ZitadelAdminClient,
} from "@/src/lib/zitadel/admin-client";
import {
  initiateOidcAuthRequest,
  loadHandoffConfig,
  type OidcAuthRequestHandoff,
} from "@/src/lib/zitadel/signup-handoff";
import {
  applyTenant,
  applyTenantMember,
  getTenant,
  tenantNamespace,
} from "@/src/lib/k8s/tenants";
import type { Tenant, TenantMember, TenantTier } from "@/src/lib/k8s/types";
// Note: listTenantsForOwner / src/lib/k8s/tenants-by-owner.ts deleted under
// spec `tenant-membership-not-in-jwt`. Duplicate-signup detection now relies
// on Zitadel's existing-user check (findUserByEmail above) plus the
// tenant-operator's idempotent reconcile keyed by zitadel_sub.
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
 * Fallback post-signup destination, used when the V2 session auto-login
 * dance (issue dashboard#41) fails for ANY reason (config missing,
 * IAM_LOGIN_CLIENT not granted yet [pending gitops#90], auth_request
 * initiation failed, etc). Routes through /login so the LoginForm
 * client component invokes Auth.js v5's CSRF-protected signIn("zitadel"),
 * which POSTs to /api/auth/signin/zitadel with the required tokens.
 *
 * NOTE: don't redirect directly to /api/auth/signin/zitadel, Auth.js v5
 * removed the GET-based sign-in initiation that v4 supported, and a GET to
 * that endpoint now throws `UnknownAction` and bounces back to
 * /login?error=Configuration.
 */
const FALLBACK_POST_SIGNUP_REDIRECT = "/login?callbackUrl=%2Fdashboard";

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
    emailVerifiedAtCreate: undefined,
    oidcHandoff: undefined,
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

    // 0.5. Initiate the Zitadel V2 OIDC auth_request so we can complete
    // the build-your-own-login-UI handshake after admin-API user creation.
    // This step sets Auth.js's state + PKCE cookies on the Server Action
    // response BEFORE the action returns, so the browser has them in hand
    // when it later follows the callbackUrl returned by CreateCallback.
    //
    // Why it runs this early: the cookies must be committed on a response
    // sent to the user agent, and the next response is THIS action's
    // return. Initiation is also cheap and never blocks the user-facing
    // outcome, failures (config missing, gitops#90 unmerged so
    // IAM_LOGIN_CLIENT not granted, network glitch) leave
    // ctx.oidcHandoff undefined and the action will fall back to the
    // standard /login redirect at the end.
    //
    // Issue: dashboard#41 (auto-login after signup).
    // Blocker: gitops#90, IAM_LOGIN_CLIENT grant on the signup-bot.
    ctx.oidcHandoff = await safeInitiateOidcAuthRequest(ctx.attemptId);

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

    // 2. Password policy.
    await advanceStep(attemptId, "policy");
    const client = getSignupZitadelAdminClient();
    const policy = await getCachedPasswordPolicy(client);
    const policyFail = checkPasswordAgainstPolicy(ctx.input.password, policy);
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

    // 4. Create the Zitadel user (or resume if one already exists with no tenant).
    await advanceStep(attemptId, "create_user");
    const userResult = await createOrResumeZitadelUser(client, ctx);
    if ("fail" in userResult) {
      return await finish(ctx, "create_user", userResult.fail);
    }
    ctx.zitadelUserId = userResult.userId;
    // Track the emailVerified value used at create-time so step 5 can decide
    // whether to call sendVerificationEmail. Spec: signup-zitadel-permissions-fix.
    ctx.emailVerifiedAtCreate = userResult.emailVerifiedAtCreate;

    // 5. Kick off verification email, only when the user was created
    // un-verified (future SMTP-enabled flow). With the current
    // emailVerified=true default per signup hotfix #5, the user has no
    // pending code to "resend"; calling Zitadel's /v2/users/.../email/resend
    // returns 400 "Code is empty (EMAIL-5w5ilin4yt)". Skip the call when
    // already verified. When SMTP is wired in a future spec and
    // emailVerified=false is set at create-time, this conditional re-enables
    // the call automatically. Spec: signup-zitadel-permissions-fix / SIGNUP-B23.
    await advanceStep(attemptId, "send_verify_email");
    if (ctx.emailVerifiedAtCreate) {
      console.info("[signup] verification email skipped, user created already verified", {
        attemptId,
      });
    } else {
      try {
        await client.sendVerificationEmail(ctx.zitadelUserId);
      } catch (err) {
        // Zitadel in dev clusters without SMTP returns errors here. Log + keep
        // going; the user can complete verification later.
        console.warn("[signup] sendVerificationEmail failed, non-fatal", {
          attemptId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 6. Apply the Tenant CR, this triggers the operator saga.
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

    // 6b. Card-first signup (dashboard#769). When paid tiers are enabled,
    // pause for in-page card collection: wait for the CreateStripeCustomer
    // saga step to write status.stripeCustomerId, then hand the non-secret
    // context to the client, which renders <PaymentStep> and calls
    // resumeSignupAfterPayment() once the trialing subscription is created.
    // The saga's WaitForBillingConfirmation step blocks org creation until
    // then, so finishing provisioning here would deadlock. When paid tiers
    // are disabled (kind autoconfirm), fall straight through to provisioning.
    if (paidTiersEnabled()) {
      await advanceStep(attemptId, "await_payment");
      const customerReady = await waitForStripeCustomer(ctx.tenantSlug);
      if (!customerReady) {
        return await finish(ctx, "await_payment", {
          code: "PROVISIONING_TIMEOUT",
          userMessage:
            "Still setting up billing for your workspace. Try again in a moment.",
        });
      }
      logger.info(
        {
          action: "signup_awaiting_payment",
          attemptId,
          tenantSlug: ctx.tenantSlug,
          tier: ctx.input.tier,
        },
        "signup paused for in-page card collection",
      );
      return {
        ok: true,
        awaitingPayment: true,
        attemptId,
        tenantSlug: ctx.tenantSlug,
        tier: ctx.input.tier,
        zitadelUserId: ctx.zitadelUserId as string,
      };
    }

    return await finishProvisioning(ctx, client);
  } catch (err) {
    // Catch-all, any uncaught exception becomes INTERNAL_ERROR.
    console.error("[signup] unhandled", {
      attemptId,
      err: err instanceof Error ? err.message : String(err),
    });
    return await finish(ctx, "create_user", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * finishProvisioning runs the post-tenant steps shared by the kind-autoconfirm
 * path (called inline by signupAction) and the card-first path (called by
 * resumeSignupAfterPayment once the trialing subscription is confirmed):
 * wait for status.zitadelOrgID → apply the owner TenantMember → wait Active →
 * auto-login → done.
 */
async function finishProvisioning(
  ctx: Ctx,
  client: ZitadelAdminClient,
): Promise<SignupActionResult> {
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
      console.error("[signup] applyTenantMember failed", {
        attemptId: ctx.attemptId,
        tenantSlug: ctx.tenantSlug,
        err: err instanceof Error ? err.message : String(err),
      });
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

    // 10. Optional auto-login (issue dashboard#41).
    //
    // If we successfully parked an OIDC auth_request at step 0.5 AND the
    // signup-bot PAT can mint sessions (IAM_LOGIN_CLIENT, gitops#90),
    // exchange the just-collected password for a Zitadel session and
    // CreateCallback the parked auth_request. The returned callbackUrl
    // lands the user on /api/auth/callback/zitadel?code=&state= which
    // Auth.js consumes using the state/PKCE cookies set at step 0.5,
    // minting the dashboard session WITHOUT bouncing through Zitadel's
    // hosted login UI.
    //
    // On any failure here we fall back to the standard /login redirect -
    // the user has a valid Zitadel account and can sign in normally.
    // This is the graceful-failure UX the acceptance criteria require.
    const redirect = await finalizeAutoLoginOrFallback(ctx, client);

    // 11. Done.
    await completeProgress(attemptId);
    logAudit("signup_ok", ctx);
    return {
      ok: true,
      attemptId,
      redirect,
    };
  } catch (err) {
    // Catch-all, any uncaught exception becomes INTERNAL_ERROR.
    console.error("[signup] unhandled", {
      attemptId,
      err: err instanceof Error ? err.message : String(err),
    });
    return await finish(ctx, "create_user", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * resumeSignupAfterPayment is card-first signup phase 2 (dashboard#769). The
 * client calls it once <PaymentStep> has created the trialing subscription.
 * It re-validates the context against the tenant CR (owner email match +
 * confirmed billing), re-parks an OIDC auth_request for auto-login, then runs
 * the shared finishProvisioning (org wait → member → owner → auto-login).
 *
 * Security: every field arrives from the client, so nothing is trusted. The
 * tenant's spec.owner must equal the supplied email, and billing must be
 * trialing/active before any owner provisioning happens — a caller cannot
 * skip payment or hijack another tenant by forging the payload.
 */
export async function resumeSignupAfterPayment(
  input: SignupResumeInput,
): Promise<SignupActionResult> {
  const attemptId = UUID_RE.test(input.attemptId) ? input.attemptId : randomUUID();

  const ctx: Ctx = {
    attemptId,
    input: {
      email: input.email,
      password: input.password,
      workspaceName: input.workspaceName,
      tier: input.tier as SignupInput["tier"],
      // Phase 2 only reads email/password/workspaceName/tier (member + owner
      // + auto-login). The create-user-only fields are already spent in
      // phase 1; fill them to satisfy the type without re-validating.
      firstName: "",
      lastName: "",
      passwordConfirm: input.password,
      acceptToS: true,
      acceptPrivacy: true,
    },
    zitadelUserId: input.zitadelUserId,
    tenantSlug: input.tenantSlug,
    emailVerifiedAtCreate: true,
    oidcHandoff: undefined,
  };

  try {
    // Re-validate against the tenant CR — the payload is client-supplied.
    const tenant = await safeGetTenant(input.tenantSlug);
    if (!tenant) {
      return await finish(ctx, "await_payment", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't find your workspace. Please start over.",
      });
    }
    if (tenant.spec.owner !== input.email) {
      logger.warn(
        { attemptId, action: "signup_resume_owner_mismatch" },
        "resume payload owner does not match tenant spec.owner",
      );
      return await finish(ctx, "await_payment", {
        code: "INTERNAL_ERROR",
        userMessage: "We couldn't verify your workspace. Please start over.",
      });
    }
    // Billing must be confirmed before we provision the owner. The saga's
    // WaitForBillingConfirmation gates org creation on the same signal, but
    // we check here too so phase 2 can never run ahead of payment.
    const billingStatus = tenant.status?.billing?.status;
    if (billingStatus !== "trialing" && billingStatus !== "active") {
      return await finish(ctx, "await_payment", {
        code: "PROVISIONING_TIMEOUT",
        userMessage: "Still confirming your payment. Try again in a moment.",
      });
    }

    // Re-park an OIDC auth_request for auto-login (fresh PKCE/state cookies).
    ctx.oidcHandoff = await safeInitiateOidcAuthRequest(attemptId);

    const client = getSignupZitadelAdminClient();
    return await finishProvisioning(ctx, client);
  } catch (err) {
    logger.error(
      {
        attemptId,
        action: "signup_resume",
        err: err instanceof Error ? err.message : String(err),
      },
      "resumeSignupAfterPayment unhandled",
    );
    return await finish(ctx, "await_payment", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * paidTiersEnabled mirrors the dashboard billing master switch
 * (DASHBOARD_BILLING_PAID_TIERS_ENABLED). When off (kind dev), signup runs
 * the autoconfirm path with no card step.
 */
function paidTiersEnabled(): boolean {
  const v = process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
  return v === "true" || v === "1";
}

// ---------------------------------------------------------------------------
// Pipeline context + finish helper
// ---------------------------------------------------------------------------

interface Ctx {
  attemptId: string;
  input: SignupInput;
  zitadelUserId: string | undefined;
  tenantSlug: string | undefined;
  /**
   * Whether the Zitadel user was created with emailVerified=true.
   * Set immediately after createHumanUser() resolves.
   * Used by step 5 to skip sendVerificationEmail when already verified.
   * Spec: signup-zitadel-permissions-fix.
   */
  emailVerifiedAtCreate: boolean | undefined;
  /**
   * The parked OIDC auth_request, populated at step 0.5 IF
   * `initiateOidcAuthRequest` succeeded. Used at step 10 to
   * CreateCallback the auth_request and auto-login the user.
   * Undefined on env-misconfig / network failure → caller falls back to
   * the standard /login redirect.
   * Issue: dashboard#41.
   */
  oidcHandoff: OidcAuthRequestHandoff | undefined;
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

async function createOrResumeZitadelUser(
  client: ZitadelAdminClient,
  ctx: Ctx,
): Promise<{ userId: string; emailVerifiedAtCreate: boolean } | { fail: FinishFailure }> {
  // The emailVerified value used at create-time is tracked so the caller can
  // set ctx.emailVerifiedAtCreate and step 5 can skip sendVerificationEmail
  // when already verified. Spec: signup-zitadel-permissions-fix.
  const emailVerified = true;
  try {
    const user = await client.createHumanUser({
      email: ctx.input.email,
      givenName: ctx.input.firstName,
      familyName: ctx.input.lastName,
      password: ctx.input.password,
      // Mark verified at create-time. Zitadel keeps unverified users in
      // STATE_INITIAL which BLOCKS password sign-in ("Password is invalid"
      // even when the password matches). The user just typed the password
      // moments ago and clicked Submit, that's our signal they own the
      // mailbox-as-identifier.  A separate post-signup verification email
      // (currently best-effort, fails silently in dev where SMTP is
      // unwired) handles real ownership confirmation; we don't gate
      // login on it.
      emailVerified,
    });
    return { userId: user.userId, emailVerifiedAtCreate: emailVerified };
  } catch (err) {
    if (err instanceof ZitadelApiError) {
      if (err.httpStatus === 409) {
        // User already exists, check if they have a tenant.
        const existing = await client.findUserByEmail(ctx.input.email);
        if (!existing) {
          return {
            fail: {
              code: "INTERNAL_ERROR",
              userMessage:
                "Account state inconsistent, contact support with this attempt ID.",
            },
          };
        }
        // The K8s `tenants-by-owner` lookup that previously gated this branch
        // was removed under spec `tenant-membership-not-in-jwt`. Per the new
        // architecture, an existing Zitadel user always means signup-resume
        // is appropriate, the tenant-operator's reconcile is idempotent
        // and keyed on zitadel_sub, so a user with an already-provisioned
        // Tenant CR will be detected at the operator layer rather than here.
        //
        // Reset the password to whatever the user just typed. Without this,
        // a retry after a first-attempt failure (e.g. tenant CR apply
        // errored after Zitadel user creation) leaves the user logging in
        // with the old password while the form thinks the new one was
        // accepted, they get "Password is invalid" on first sign-in even
        // though signup said success. Idempotent: setting the same password
        // twice is a no-op.
        try {
          await client.setUserPassword(existing.userId, ctx.input.password);
        } catch (err) {
          // Non-fatal: the user can use the prior password or the
          // forgot-password flow. Log so support can correlate.
          console.warn("[signup] resume-path password update failed", {
            attemptId: ctx.attemptId,
            userId: existing.userId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        // For the resume path, treat as emailVerified=true (the only value
        // this codebase has ever written). Spec: signup-zitadel-permissions-fix.
        return { userId: existing.userId, emailVerifiedAtCreate: true };
      }
      if (err.httpStatus >= 500 || err.httpStatus === 0) {
        return {
          fail: {
            code: "ZITADEL_UNAVAILABLE",
            userMessage:
              "We're having trouble reaching our identity service. Try again in a moment.",
          },
        };
      }
      // Other 4xx, treat password-policy errors as POLICY_VIOLATION.
      if (/password|complexity/i.test(err.zitadelErrorMessage ?? "")) {
        return {
          fail: {
            code: "POLICY_VIOLATION",
            userMessage: err.zitadelErrorMessage ?? "Password doesn't meet the policy.",
            fieldErrors: { password: "Password doesn't meet the policy." },
          },
        };
      }
      return {
        fail: {
          code: "INTERNAL_ERROR",
          userMessage: "We couldn't create your account. Please try again.",
        },
      };
    }
    throw err;
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

/**
 * waitForStripeCustomer polls for the CreateStripeCustomer saga step to write
 * status.stripeCustomerId (card-first signup, dashboard#769). Returns true
 * once present, false on timeout. The Payment Element cannot create a
 * SetupIntent until this customer exists.
 */
async function waitForStripeCustomer(name: string): Promise<boolean> {
  const deadline = Date.now() + TENANT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const t = await getTenant(name);
      if (t.status?.stripeCustomerId) {
        return true;
      }
      if (t.status?.phase === "Failed") {
        return false;
      }
    } catch {
      // CR may not exist yet on the very first poll, retry.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
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

// ---------------------------------------------------------------------------
// Auto-login (issue dashboard#41), V2 session + CreateCallback handoff.
// ---------------------------------------------------------------------------

/**
 * Wraps `initiateOidcAuthRequest` so a failure NEVER blocks signup. Returns
 * undefined when the handoff can't be set up (env misconfig, gitops#90
 * unmerged so the bot lacks IAM_LOGIN_CLIENT, network glitch, etc), the
 * action then falls back to the standard /login redirect at the end.
 *
 * SECURITY: must not log error contents that might include the OIDC
 * client secret if it appears in error envelopes, we only log a stable
 * marker string and the attemptId.
 */
async function safeInitiateOidcAuthRequest(
  attemptId: string,
): Promise<OidcAuthRequestHandoff | undefined> {
  // Skip entirely when handoff config is missing, saves the cookie-set
  // overhead in dev environments that don't have AUTH_URL set.
  if (loadHandoffConfig() === null) {
    logger.info(
      { attemptId, action: "signup_auto_login" },
      "auth_request init skipped, handoff config missing (likely dev without ZITADEL_CLIENT_ID/AUTH_URL)",
    );
    return undefined;
  }

  try {
    const handoff = await initiateOidcAuthRequest();
    if (!handoff) {
      logger.info(
        { attemptId, action: "signup_auto_login" },
        "auth_request init returned null, falling back to standard /login",
      );
      return undefined;
    }
    return handoff;
  } catch (err) {
    logger.warn(
      {
        attemptId,
        action: "signup_auto_login",
        err: err instanceof Error ? err.message : String(err),
      },
      "auth_request init threw, falling back to standard /login",
    );
    return undefined;
  }
}

/**
 * Final-step auto-login. Returns the redirect URL the SignupForm follows
 * after the action completes. On any failure (no parked auth_request,
 * IAM_LOGIN_CLIENT 403, session API outage) returns the standard /login
 * redirect, the user has a valid Zitadel account and can sign in via the
 * existing hosted-login fallback.
 */
async function finalizeAutoLoginOrFallback(
  ctx: Ctx,
  client: ZitadelAdminClient,
): Promise<string> {
  if (!ctx.oidcHandoff) {
    // No parked auth_request → standard path. This is the BLOCKED state
    // until gitops#90 lands AND a redeploy picks up the new env.
    return FALLBACK_POST_SIGNUP_REDIRECT;
  }

  try {
    // 1. Create a Zitadel V2 session bound to the just-provisioned user.
    //    SECURITY: ctx.input.password is consumed inline here and never
    //    leaves the action; ZitadelAdminClient is responsible for never
    //    logging the body. The signup-bot PAT must hold IAM_LOGIN_CLIENT
    //    (gitops#90), without it Zitadel returns 403 and we fall back.
    const session = await client.createSession({
      loginName: ctx.input.email,
      password: ctx.input.password,
    });

    // 2. Bind the session to the parked auth_request, receive the
    //    callbackUrl pointing at /api/auth/callback/zitadel.
    const { callbackUrl } = await client.finalizeAuthRequest({
      authRequestId: ctx.oidcHandoff.authRequestId,
      session,
    });

    logger.info(
      {
        attemptId: ctx.attemptId,
        action: "signup_auto_login",
        outcome: "ok",
        // Never log the sessionToken or the full callbackUrl (contains code).
      },
      "auto-login handoff complete",
    );

    return callbackUrl;
  } catch (err) {
    // V2 session/CreateCallback failed. The most common cause is
    // IAM_LOGIN_CLIENT not yet granted on the signup-bot (gitops#90).
    // Surface a structured warning so the failure is debuggable from
    // pod logs, then fall back to the standard hosted-login redirect so
    // the user CAN still complete signin.
    const isZitadelErr = err instanceof ZitadelApiError;
    logger.warn(
      {
        attemptId: ctx.attemptId,
        action: "signup_auto_login",
        outcome: "fallback",
        httpStatus: isZitadelErr ? err.httpStatus : undefined,
        zitadelErrorId: isZitadelErr ? err.zitadelErrorId : undefined,
        zitadelErrorMessage: isZitadelErr ? err.zitadelErrorMessage : undefined,
        err: !isZitadelErr && err instanceof Error ? err.message : undefined,
      },
      "auto-login V2 session/CreateCallback failed, falling back to /login (likely gitops#90 not yet merged)",
    );
    return FALLBACK_POST_SIGNUP_REDIRECT;
  }
}
