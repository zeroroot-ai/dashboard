/**
 * types.ts, Signup form Zod schemas and shared TypeScript types.
 *
 * Single source of truth for:
 *  - `signupInputSchema`, step-one form shape validated by both the Client
 *    Component (React Hook Form resolver) and the Server Action (runtime
 *    guard). It carries NO password: step one only asks for a link to be sent.
 *  - `completeSignupInputSchema`, the post-redemption form shape, which is
 *    where the password is collected.
 *  - `SignupFailureCode`, exhaustive union of all terminal error states.
 *  - `SignupActionResult`, discriminated union returned by `signupAction`.
 *  - `ProvisioningStep` / `ProvisioningProgress`, Redis progress state shape
 *    consumed by `<ProvisioningPanel>` via the poll endpoint.
 *
 * No runtime imports from server-only modules. Safe for both client and server.
 */

import { z } from "zod";
import { selfServeTierIds } from "@/src/lib/pricing-display";

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

// `selfServeTierIds` is a readonly array, z.enum requires a non-empty tuple.
// Cast is safe because the array is guaranteed non-empty at build time.
const tierTuple = selfServeTierIds as unknown as [string, ...string[]];

export const signupInputSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(100, "First name must be 100 characters or fewer"),

  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(100, "Last name must be 100 characters or fewer"),

  email: z
    .string()
    .email("Enter a valid email address")
    .max(254, "Email must be 254 characters or fewer"),

  // dashboard#44: user-visible label is "Company Name". The form-field
  // name, schema field, and downstream Tenant CR all still use
  // `workspaceName` to avoid touching the operator wiring.
  workspaceName: z
    .string()
    .min(2, "Company name must be at least 2 characters")
    .max(63, "Company name must be 63 characters or fewer")
    .regex(
      /^[a-zA-Z0-9 _-]+$/,
      "Company name may only contain letters, numbers, spaces, hyphens, and underscores",
    ),

  tier: z.enum(tierTuple, {
    errorMap: () => ({ message: "Select a valid plan" }),
  }),

  acceptToS: z.literal(true, {
    errorMap: () => ({ message: "Please accept the Terms of Service to continue" }),
  }),

  acceptPrivacy: z.literal(true, {
    errorMap: () => ({ message: "Please accept the Privacy Policy to continue" }),
  }),
});

export type SignupInput = z.infer<typeof signupInputSchema>;

/**
 * Completion-form schema — the fields collected AFTER the emailed link is
 * redeemed.
 *
 * The password lives here rather than on the first screen because it must not
 * exist anywhere while the address is still unproven. Carrying it across the
 * mail round-trip would mean holding a credential for an address that, at the
 * moment it was stored, nobody had shown they controlled.
 *
 * Everything else about the signup — address, company name, plan — is NOT in
 * this schema and is NOT sent at completion. The daemon reads all of it back
 * from the verification row the session resolves to, so a redeemed session
 * cannot be pointed at a different address.
 */
export const completeSignupInputSchema = z
  .object({
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .max(256, "Password must be 256 characters or fewer"),
    passwordConfirm: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.passwordConfirm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passwordConfirm"],
        message: "Passwords don't match",
      });
    }
  });

export type CompleteSignupFormInput = z.infer<typeof completeSignupInputSchema>;

// ---------------------------------------------------------------------------
// Post-signup destination
// ---------------------------------------------------------------------------

/**
 * Where a completed signup lands. Routes through /login so the LoginForm
 * client component invokes Auth.js v5's CSRF-protected signIn("zitadel").
 * Shared here (client-safe module) because BOTH sides navigate to it: the
 * Server Action's success result, and the <ProvisioningPanel /> when the
 * live-readiness fallback resolves a timed-out attempt (dashboard#967) —
 * a path where the action returned before any success redirect existed.
 * The full rationale (and why a direct /api/auth/signin/zitadel redirect
 * breaks) is documented at the use site in app/actions/signup.ts.
 */
export const POST_SIGNUP_REDIRECT = "/login?callbackUrl=%2Fdashboard";

// ---------------------------------------------------------------------------
// Failure codes
// ---------------------------------------------------------------------------

/**
 * Exhaustive list of terminal failure states that `signupAction` can return.
 * Each code maps to a UI-level remediation in `<SignupForm>`.
 */
export type SignupFailureCode =
  | "RATE_LIMITED"
  | "POLICY_VIOLATION"
  | "WORKSPACE_TAKEN"
  | "ALREADY_PROVISIONED"
  | "ZITADEL_UNAVAILABLE"
  | "PROVISIONING_FAILED"
  | "PROVISIONING_TIMEOUT"
  | "MEMBERSHIP_TIMEOUT"
  | "TOS_MISSING"
  | "INTERNAL_ERROR"
  /**
   * The completion session is absent, expired or already spent. One code for
   * all of those, mirroring the daemon, which answers them identically so
   * redemption cannot be used to probe which signups exist.
   */
  | "VERIFICATION_INVALID"
  /**
   * Vault namespace provisioning failed during tenant signup.
   * The tenant-operator saga rolls back and sets this code in the
   * SignupProgressStore so the ProvisioningPanel can render an actionable
   * retry CTA.  (Spec 4 Task 20, Requirement 7.1)
   */
  | "SECRETS_NAMESPACE_FAILED";

// ---------------------------------------------------------------------------
// Server Action result
// ---------------------------------------------------------------------------

export type SignupActionResult =
  | {
      ok: true;
      /** Opaque UUID used to poll `/api/signup/progress/:id`. */
      attemptId: string;
      /** URL the client should follow on success (Zitadel OIDC callback). */
      redirect: string;
    }
  | {
      /**
       * Step one succeeded: a verification message was requested.
       *
       * There is deliberately nothing else in this variant. It is returned
       * identically whether the address is new or already has an account —
       * anything that varied between the two would tell an anonymous caller
       * which addresses are registered.
       */
      ok: true;
      phase: "verify_email";
      attemptId: string;
    }
  | {
      /**
       * Completion is waiting on the card. The SetupIntent and its customer
       * were created AFTER redemption, which is the ordering this whole flow
       * exists to enforce: no billing object for an unproven address.
       */
      ok: true;
      phase: "card";
      attemptId: string;
      cardClientSecret: string;
    }
  | {
      ok: false;
      /** Same opaque UUID for error log correlation. */
      attemptId: string;
      code: SignupFailureCode;
      /** User-facing prose, safe to display verbatim. */
      userMessage: string;
      /**
       * Set ONLY for the non-fatal `PROVISIONING_TIMEOUT` code
       * (dashboard#967): the workspace slug the action was waiting on.
       * The <ProvisioningPanel /> hands it back to the progress endpoint
       * (`?slug=`), which probes live tenant readiness once the stored
       * record is a terminal timeout — the Server Action has already
       * returned and can never flip the record to `ok` itself. Disclosed
       * only to the browser holding the verified-session cookie, and it
       * is derived from the workspace name that same user typed.
       */
      tenantSlug?: string;
      /**
       * Optional per-field error overrides, keyed by form-field name. Plain
       * string keys rather than `keyof SignupInput` because the two screens
       * have different fields: step one has no password, and the completion
       * screen has nothing else.
       */
      fieldErrors?: Partial<Record<string, string>>;
    };

/**
 * Input to `completeSignup`, the step that runs on /signup/complete.
 *
 * Note how little is here. The email, company name, plan and billing customer
 * are all absent by design: the daemon reads them from the verification row the
 * session cookie resolves to. A completion call therefore cannot describe a
 * signup other than the one whose link was opened.
 */
export interface CompleteSignupInput {
  /** The password chosen on the completion screen. Write-only, never persisted here. */
  password: string;
  /** Paid path only: the payment method produced by confirming the SetupIntent. */
  paymentMethodId?: string;
}

// ---------------------------------------------------------------------------
// Provisioning progress
// ---------------------------------------------------------------------------

/**
 * All possible step names written to Redis by `signupAction`.
 * Steps are ordered chronologically; the poll endpoint returns the current one.
 */
export type ProvisioningStep =
  | "rate_limit"
  | "policy"
  /**
   * Card-first signup (dashboard#785): phase 2 begins by creating the trialing
   * subscription on the already-confirmed card, BEFORE the account/company
   * exist. Absent (skipped) when paid tiers are disabled (kind dev autoconfirm).
   */
  | "create_billing"
  | "create_user"
  | "send_verify_email"
  | "apply_tenant"
  | "setup_workspace"
  | "apply_member"
  | "grant_owner_role"
  /**
   * Vault namespace provisioning step published by the tenant-operator saga
   * after `ensureVaultNamespace` completes.  (Spec 4 Task 19/20, Req 7.1–7.2)
   */
  | "provisioning_secrets_backend"
  | "done";

/**
 * JSON structure stored in Redis at `signup-progress:<attemptId>`.
 * Returned verbatim by `GET /api/signup/progress/:id`.
 */
export interface ProvisioningProgress {
  step: ProvisioningStep;
  /** Unix epoch milliseconds when the current step started. */
  stepStartedAt: number;
  /** Set only when the action has finished (successfully or not). */
  terminalState?: "ok" | "failed" | "timeout";
  /** Present on `terminalState === "failed"` or `"timeout"`. */
  error?: {
    code: SignupFailureCode;
    userMessage: string;
  };
}
