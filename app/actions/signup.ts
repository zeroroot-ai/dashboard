// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
 * Langfuse/Redis/Neo4j init all happen downstream of the Tenant CR it
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
  POST_SIGNUP_REDIRECT,
  PROVISIONING_TIMEOUT_MESSAGE,
  type SignupInput,
  type SignupActionResult,
  type CompleteSignupInput,
  type SignupFailureCode,
  type ProvisioningStep,
} from "@/app/(public)/signup/types";
import {
  requestSignupVerification,
  completeSignupOwner,
  getSignupStep,
  type SignupStepStatus,
} from "@/src/lib/signup/owner-provisioning";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
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
import { recordSignup } from "@/src/lib/metrics/auth";


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How long to wait for Tenant.status.zitadelOrgID to appear. The Tenant CR is
 * now created asynchronously by the tenant-operator, which polls the daemon
 * pending-provisioning queue every ~15s (gibson#949), so the budget covers both
 * the operator-poll latency (CR creation) AND the full provisioning saga.
 * Exceeding it is non-fatal — the client ProvisioningPanel stays on the
 * "still working" holding state and keeps polling with `?slug=`, so the
 * live-readiness fallback in `/api/signup/progress/:id` resolves the attempt
 * once the operator finishes (dashboard#967). No email is sent: nothing in
 * the platform sends a workspace-ready notification today (see
 * PROVISIONING_TIMEOUT_MESSAGE in ../(public)/signup/types).
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
 * owner-provisioning preamble). Envoy's app-vhost catch-all route
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
 *
 * The constant itself lives in ./types (client-safe) since dashboard#967:
 * the <ProvisioningPanel /> navigates to the same destination when the
 * live-readiness fallback resolves a timed-out attempt after this action
 * has already returned. This comment block stays here because the
 * rationale is server-flow rationale.
 */

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
    // 0. Schema guard (defense-in-depth; Client Component already validates).
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
    //    No Zitadel user and no Tenant CR. Nothing exists for an address until
    //    someone has shown they can receive mail at it.
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
 * finishProvisioning runs the post-tenant steps shared by `completeSignup` (no
 * external step) and `finishSignupAfterStep` (after the step is done): poll the
 * daemon's
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
 * carrying the tenant slug; the client-side ProvisioningPanel keeps polling the
 * progress store with that slug, so the user is never sent into a workspace
 * that isn't ready and the holding state still resolves itself.
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
        userMessage: PROVISIONING_TIMEOUT_MESSAGE,
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
 * does not accept from the caller: no email, no company name, no plan. All of
 * those are read daemon-side from the verification row the session resolves
 * to, so a caller who redeemed a link for one address cannot provision a
 * workspace for another. The only input is the password the user just typed.
 *
 * Order:
 *   0. Refuse a known-breached password, before anything at all exists.
 *   1. Create the founding-owner identity and enqueue the tenant (the daemon
 *      consumes the session here, so it cannot be replayed into a second
 *      workspace).
 *   2. If the daemon holds the tenant for an external signup step, return the
 *      `external_step` phase. The browser goes to the step, and
 *      `finishSignupAfterStep` continues when it comes back.
 *   3. Otherwise poll provisioning to Ready and hand back the /login redirect.
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
  // the password exists, and it runs before the identity and the tenant exist,
  // before anything a refusal would have to be rolled back from. A rejected
  // attempt leaves the verified session live so the user simply picks another
  // password on the same screen.
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

  const ctx = ctxFromSession(session);

  try {
    // 1. Create the founding-owner identity + enqueue the tenant. The daemon
    //    reads the address, company name and plan from its own verification
    //    row; this call supplies only the session and the password.
    await advanceStep(ctx.attemptId, "create_user");
    const clientIp = await resolveClientIp();
    let result: Awaited<ReturnType<typeof completeSignupOwner>>;
    try {
      result = await completeSignupOwner({
        attemptId: ctx.attemptId,
        verifiedSessionToken: session.verifiedSessionToken,
        password: input.password,
        clientIp,
      });
    } catch (err) {
      return await finish(ctx, "create_user", mapCompletionError(err));
    }
    ctx.zitadelUserId = result.ownerUserId;
    ctx.tenantSlug = result.tenantId;

    // The session is spent daemon-side. Mark the cookie spent rather than
    // deleting it: readVerifiedSession treats a spent session as absent, so a
    // stale cookie cannot re-enter a completion, and the completion page sends
    // a returning browser to /login. Deleting it here made Next.js re-render
    // the route inside this action's response, and the page then redirected to
    // /signup?verify=invalid before the client could reach /login
    // (dashboard#79). The spent cookie also keeps the step link and the tenant
    // slug for the step page.
    const stepLink = result.stepUrl
      ? buildStepLink(result.stepUrl, result.stepToken)
      : undefined;
    await writeVerifiedSession({
      ...session,
      spent: true,
      tenantSlug: result.tenantId,
      ...(stepLink ? { stepLink } : {}),
    });

    // 2. The daemon holds the tenant for an external step.
    if (stepLink) {
      if (!getDeploymentProfile().signupStepText) {
        // The daemon has a step URL and the dashboard has no texts for it.
        // That is an operator misconfiguration; the user cannot act on it.
        logger.error(
          { attemptId: ctx.attemptId, action: "signup_step_unconfigured" },
          "the daemon returned a signup step and the DASHBOARD_SIGNUP_STEP_* texts are not set",
        );
        return await finish(ctx, "external_step", {
          code: "INTERNAL_ERROR",
          userMessage: "Something went wrong on our end.",
        });
      }
      await advanceStep(ctx.attemptId, "external_step");
      return { ok: true, phase: "external_step", attemptId: ctx.attemptId };
    }

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
    return await finish(ctx, "create_user", {
      code: "INTERNAL_ERROR",
      userMessage: "Something went wrong on our end.",
    });
  }
}

/**
 * readSignupStepState reports the state of the external signup step of the
 * signup in this browser. The step page polls it after the browser returns.
 *
 * The attempt id comes from the session cookie, never from the caller. With no
 * cookie, or a cookie from before completion, the answer is `none`.
 */
export async function readSignupStepState(): Promise<SignupStepStatus> {
  const session = await readCompletedSession();
  if (!session?.stepLink) return "none";
  try {
    return await getSignupStep(session.attemptId);
  } catch (err) {
    logger.warn(
      {
        attemptId: session.attemptId,
        action: "signup_step_state",
        err: err instanceof Error ? err.message : String(err),
      },
      "signup step state read failed; reporting waiting",
    );
    return "waiting";
  }
}

/**
 * finishSignupAfterStep runs after the external step is done: it waits for
 * the tenant to be Ready and hands back the /login redirect, exactly as
 * `completeSignup` does for a signup with no step.
 */
export async function finishSignupAfterStep(): Promise<SignupActionResult> {
  const session = await readCompletedSession();
  if (!session?.tenantSlug) {
    return {
      ok: false,
      attemptId: session?.attemptId ?? "",
      code: "VERIFICATION_INVALID",
      userMessage: "That link is no longer valid. Please start again.",
    };
  }
  const ctx = ctxFromSession(session);
  ctx.tenantSlug = session.tenantSlug;
  return await finishProvisioning(ctx);
}

/**
 * buildStepLink adds the opaque step token to the step URL as the query
 * parameter `token`, the contract of gibson#895 and billing#20.
 */
function buildStepLink(stepUrl: string, stepToken: string): string {
  const url = new URL(stepUrl);
  url.searchParams.set("token", stepToken);
  return url.toString();
}

function ctxFromSession(session: VerifiedSignupSession): Ctx {
  return {
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
    // Non-fatal timeout only (dashboard#967): the action — the sole
    // progress-store writer — has returned, so the stored timeout record
    // can never flip to ok on its own. The panel hands this slug back to
    // the progress endpoint (`?slug=`), which probes live tenant readiness
    // and synthesizes the ok record once the saga completes.
    tenantSlug:
      failure.code === "PROVISIONING_TIMEOUT" ? ctx.tenantSlug : undefined,
  };
}

function logAudit(
  outcome: "signup_ok" | "signup_fail",
  ctx: Ctx,
  failureCode?: SignupFailureCode,
): void {
  recordSignup(
    outcome === "signup_ok" ? "ok" : failureCode === "RATE_LIMITED" ? "rate_limited" : "failed",
    failureCode ?? "",
  );
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
 * readVerifiedSession / writeVerifiedSession / readCompletedSession — the
 * completion capability, in an httpOnly cookie.
 *
 * Every post-redemption action reads the session from here rather than taking
 * it as an argument. A session passed as an argument is a session the caller
 * chooses; a session read from an httpOnly cookie is one the browser cannot
 * read, forge, or move to another tab's signup.
 */
async function readVerifiedSession(): Promise<VerifiedSignupSession | null> {
  const jar = await cookies();
  const session = decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);
  // A spent session is no capability: the daemon already consumed it.
  if (session?.spent) return null;
  return session;
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

/**
 * readCompletedSession reads a session that completion has spent. The step
 * page uses it: the account exists, and the cookie holds the step link and
 * the tenant slug.
 */
async function readCompletedSession(): Promise<VerifiedSignupSession | null> {
  const jar = await cookies();
  const session = decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);
  return session?.spent ? session : null;
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
