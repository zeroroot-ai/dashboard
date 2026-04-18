/**
 * User-facing error catalog for auth flows.
 *
 * Single source of truth for all user-visible error copy. Every code in the
 * closed `UserFacingErrorCode` union must have a corresponding entry in
 * `ERROR_TABLE`. The `satisfies` constraint on that map enforces exhaustiveness
 * at compile-time: adding a code to the union without a row is a type error.
 *
 * Design constraints:
 * - Pure data, no business logic.
 * - English-only for now; all strings live in one map so i18n extraction is
 *   straightforward.
 * - No external dependencies.
 *
 * @module errors/user-facing
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Closed union of every error code the auth surface can produce. Extending
 * this union requires a matching entry in {@link ERROR_TABLE}; the
 * `satisfies` guard will fail to compile otherwise.
 */
export type UserFacingErrorCode =
  | "COMPANY_NAME_TAKEN"
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "EMAIL_NOT_VERIFIED"
  | "PASSWORD_POLICY"
  | "PASSWORD_BREACHED"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "TENANT_FORBIDDEN"
  | "SLUG_OWNED_BY_OTHER_USER";

/**
 * The resolved, display-ready representation of a user-facing error.
 *
 * `title` is a short headline (≤60 chars) suitable for an alert heading.
 * `description` is one or two sentences that explain what happened and what
 * the user can do. `action`, when present, is a primary call-to-action link.
 * `correlationId`, when present, is the per-request ID for support reference.
 */
export interface UserFacingError {
  /** The originating error code — useful for programmatic switching in UI. */
  code: UserFacingErrorCode;
  /** Short headline shown as an alert title. */
  title: string;
  /** One or two sentences describing the error and suggested next step. */
  description: string;
  /** Optional primary call-to-action for remediation. */
  action?: {
    label: string;
    href: string;
  };
  /**
   * Per-request correlation ID, present only for server-side failures where
   * the caller passes one. Enables support to locate the server log line.
   */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Internal table shape
// ---------------------------------------------------------------------------

/**
 * The static portion of an error entry — everything except the runtime
 * `correlationId` which is injected by {@link resolveUserFacingError}.
 */
type ErrorEntry = Omit<UserFacingError, "code" | "correlationId">;

// ---------------------------------------------------------------------------
// Error table
// ---------------------------------------------------------------------------

/**
 * Central map of all user-facing error entries.
 *
 * The `satisfies Record<UserFacingErrorCode, ErrorEntry>` constraint makes
 * TypeScript verify that every member of the union has an entry. If a new
 * code is added to `UserFacingErrorCode` without a corresponding row here,
 * the file will not compile.
 */
const ERROR_TABLE = {
  COMPANY_NAME_TAKEN: {
    title: "Workspace name already taken",
    description:
      "A workspace with that name already exists. Please choose a different name for your company or workspace.",
    action: undefined,
  },

  EMAIL_ALREADY_REGISTERED: {
    title: "Email already registered",
    description:
      "An account with this email address already exists. Sign in to your existing account or reset your password if you've forgotten it.",
    action: {
      label: "Sign in",
      href: "/login",
    },
  },

  INVALID_CREDENTIALS: {
    title: "Invalid email or password",
    description:
      "The email address or password you entered is incorrect. Please try again.",
    action: {
      label: "Forgot your password?",
      href: "/forgot-password",
    },
  },

  ACCOUNT_LOCKED: {
    title: "Account temporarily locked",
    description:
      "Too many failed sign-in attempts have locked this account. Check your email for instructions to unlock it, or reset your password.",
    action: {
      label: "Reset your password",
      href: "/forgot-password",
    },
  },

  EMAIL_NOT_VERIFIED: {
    title: "Email address not verified",
    description:
      "Please verify your email address before signing in. Check your inbox for a verification link, or request a new one.",
    action: {
      label: "Resend verification email",
      href: "/verify-email",
    },
  },

  PASSWORD_POLICY: {
    title: "Password does not meet requirements",
    description:
      "Your password must be at least 12 characters and include uppercase letters, lowercase letters, numbers, and symbols.",
    action: undefined,
  },

  PASSWORD_BREACHED: {
    title: "Password found in a data breach",
    description:
      "This password has appeared in a known data breach and cannot be used. Please choose a unique password that you haven't used elsewhere.",
    action: undefined,
  },

  TOKEN_EXPIRED: {
    title: "Link has expired",
    description:
      "This link is no longer valid. Links expire for security reasons. Please request a new one.",
    action: {
      label: "Request a new link",
      href: "/forgot-password",
    },
  },

  TOKEN_INVALID: {
    title: "Invalid or already-used link",
    description:
      "This link is invalid or has already been used. Please request a new link if you still need access.",
    action: {
      label: "Request a new link",
      href: "/forgot-password",
    },
  },

  CAPTCHA_REQUIRED: {
    title: "Verification required",
    description:
      "Please complete the verification challenge before continuing. This helps us keep the platform secure.",
    action: undefined,
  },

  CAPTCHA_FAILED: {
    title: "Verification challenge failed",
    description:
      "We could not verify your response to the challenge. Please try again.",
    action: undefined,
  },

  RATE_LIMITED: {
    title: "Too many requests",
    description:
      "You have made too many requests in a short period. Please wait a moment before trying again.",
    action: undefined,
  },

  SERVICE_UNAVAILABLE: {
    title: "Service temporarily unavailable",
    description:
      "We encountered a problem processing your request. Please try again in a moment. If the issue persists, contact support.",
    action: undefined,
  },

  SESSION_EXPIRED: {
    title: "Your session has expired",
    description:
      "You have been signed out because your session expired. Please sign in again to continue where you left off.",
    action: {
      label: "Sign in",
      href: "/login",
    },
  },

  TENANT_FORBIDDEN: {
    title: "Access denied",
    description:
      "You do not have access to this workspace. Switch to a workspace you belong to, or contact the workspace owner to request access.",
    action: undefined,
  },

  SLUG_OWNED_BY_OTHER_USER: {
    title: "Workspace identifier already claimed",
    description:
      "The workspace identifier you requested is already in use by another account. Please contact support if you believe this is an error.",
    action: undefined,
  },
} satisfies Record<UserFacingErrorCode, ErrorEntry>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an error code to its full display representation.
 *
 * @param code - A member of the {@link UserFacingErrorCode} union. TypeScript
 *   ensures only valid codes can be passed; the lookup cannot fail at runtime.
 * @param correlationId - Optional per-request ID to attach, enabling users to
 *   quote a reference when contacting support.
 * @returns A fully-populated {@link UserFacingError} ready for rendering.
 *
 * @example
 * ```ts
 * const err = resolveUserFacingError('RATE_LIMITED', correlationId);
 * // err.title === 'Too many requests'
 * ```
 */
export function resolveUserFacingError(
  code: UserFacingErrorCode,
  correlationId?: string
): UserFacingError {
  const entry = ERROR_TABLE[code];
  const resolved: UserFacingError = {
    code,
    title: entry.title,
    description: entry.description,
  };
  if (entry.action !== undefined) {
    resolved.action = entry.action;
  }
  if (correlationId !== undefined) {
    resolved.correlationId = correlationId;
  }
  return resolved;
}
