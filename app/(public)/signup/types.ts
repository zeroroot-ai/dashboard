/**
 * types.ts — Signup form Zod schemas and shared TypeScript types.
 *
 * Single source of truth for:
 *  - `signupInputSchema` — form shape validated by both the Client Component
 *    (React Hook Form resolver) and the Server Action (runtime guard).
 *  - `SignupFailureCode` — exhaustive union of all terminal error states.
 *  - `SignupActionResult` — discriminated union returned by `signupAction`.
 *  - `ProvisioningStep` / `ProvisioningProgress` — Redis progress state shape
 *    consumed by `<ProvisioningPanel>` via the poll endpoint.
 *
 * No runtime imports from server-only modules. Safe for both client and server.
 */

import { z } from "zod";
import { selfServeTierIds } from "@/src/lib/pricing-display";

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

// `selfServeTierIds` is a readonly array — z.enum requires a non-empty tuple.
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

  // Confirm-password field — validated below via .superRefine after both
  // password fields are parsed so the user gets a "doesn't match" error tied
  // to the confirm field rather than the password field.
  passwordConfirm: z.string(),

  workspaceName: z
    .string()
    .min(2, "Workspace name must be at least 2 characters")
    .max(63, "Workspace name must be 63 characters or fewer")
    .regex(
      /^[a-zA-Z0-9 _-]+$/,
      "Workspace name may only contain letters, numbers, spaces, hyphens, and underscores",
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
  | "INTERNAL_ERROR";

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
      ok: false;
      /** Same opaque UUID for error log correlation. */
      attemptId: string;
      code: SignupFailureCode;
      /** User-facing prose — safe to display verbatim. */
      userMessage: string;
      /**
       * Optional per-field error overrides keyed by `signupInputSchema` field
       * names. The Client Component uses these to focus the first errored field.
       */
      fieldErrors?: Partial<Record<keyof SignupInput, string>>;
    };

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
  | "create_user"
  | "send_verify_email"
  | "apply_tenant"
  | "setup_workspace"
  | "apply_member"
  | "grant_owner_role"
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
