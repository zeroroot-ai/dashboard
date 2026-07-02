/**
 * types.ts, Signup form Zod schemas and shared TypeScript types.
 *
 * Single source of truth for:
 *  - `signupInputSchema`, form shape validated by both the Client Component
 *    (React Hook Form resolver) and the Server Action (runtime guard).
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

  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(256, "Password must be 256 characters or fewer"),

  // Confirm-password field, validated below via .superRefine after both
  // password fields are parsed so the user gets a "doesn't match" error tied
  // to the confirm field rather than the password field.
  passwordConfirm: z.string(),

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
}).superRefine((data, ctx) => {
  if (data.password !== data.passwordConfirm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["passwordConfirm"],
      message: "Passwords don't match",
    });
  }
});

export type SignupInput = z.infer<typeof signupInputSchema>;

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
       * Card-first signup (dashboard#785): phase 1 validated the form and
       * created ONLY the Stripe customer + a SetupIntent — NO account, NO
       * company yet. The client confirms the card against `cardClientSecret`
       * with the inline Payment Element, then calls `completeSignup` with the
       * resulting payment method. Nothing (user or Tenant CR) is created until
       * that card clears. `stripeCustomerId` is non-secret and is re-verified
       * server-side in phase 2 before any subscription is created.
       */
      ok: true;
      phase: "card";
      attemptId: string;
      cardClientSecret: string;
      stripeCustomerId: string;
      tenantSlug: string;
      tier: string;
    }
  | {
      ok: false;
      /** Same opaque UUID for error log correlation. */
      attemptId: string;
      code: SignupFailureCode;
      /** User-facing prose, safe to display verbatim. */
      userMessage: string;
      /**
       * Optional per-field error overrides keyed by `signupInputSchema` field
       * names. The Client Component uses these to focus the first errored field.
       */
      fieldErrors?: Partial<Record<keyof SignupInput, string>>;
    };

/**
 * Input to `completeSignup` (card-first signup phase 2, dashboard#785). The
 * client passes back the phase-1 customer id + the confirmed payment method,
 * plus the full signup fields (password is held in form state, never persisted
 * server-side). Phase 2 verifies the customer belongs to this email, creates
 * the trialing subscription, THEN creates the Zitadel user + Tenant CR and
 * provisions — so no account or company exists until the card has cleared.
 */
export interface CompleteSignupInput {
  attemptId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  tenantSlug: string;
  tier: string;
  email: string;
  password: string;
  workspaceName: string;
  firstName: string;
  lastName: string;
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
