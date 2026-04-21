/**
 * Zod input schemas for every CRD Server Action.
 *
 * Schemas are the canonical input-validation layer. Every action parses its
 * input through the matching `*Input` schema AFTER the authorization gate
 * (session + permission + tenant-scope) has cleared, so unauthenticated /
 * unauthorized callers cannot mine validation messages as an enumeration
 * oracle.
 *
 * All object schemas are `.strict()` — unknown keys are rejected.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * DNS-1123 label: lowercase alphanumeric + hyphen, 1-63 chars,
 * no leading/trailing hyphen. Used for tenant names, member names,
 * enrollment names, component names.
 */
export const dns1123Label = z
  .string()
  .min(1, "must not be empty")
  .max(63, "must be 63 characters or fewer")
  .regex(
    /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/,
    "must be a DNS-1123 label (lowercase alphanumeric + hyphen; must start and end with alphanumeric)",
  );

export const tenantNameSchema = dns1123Label;

/**
 * Strict RFC 5322-ish email. Zod's built-in email is permissive enough to
 * accept CR/LF bytes, so we add a defensive check that rejects any control
 * character (CR, LF, NUL, TAB, etc.).
 */
export const emailSchema = z
  .string()
  .min(3, "email is too short")
  .max(254, "email exceeds RFC 5321 local+domain length limit")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\x00-\x1f\x7f]*$/, "email must not contain control characters")
  .email("must be a valid email address");

/**
 * Closed allowlist of component kinds. Update this list in the same PR when
 * the daemon adds a new kind — on purpose, so a rogue `kind` cannot be
 * injected through the dashboard.
 */
export const componentKindSchema = z.enum(["agent", "tool", "plugin"]);

export const componentRefSchema = z
  .object({
    kind: componentKindSchema,
    name: dns1123Label,
  })
  .strict();

export const memberRoleSchema = z.enum(["admin", "member", "viewer"]);

// Canonical Gibson plan IDs — must match `TenantTier` in `src/lib/k8s/types.ts`
// AND the operator's `plans.PlanID` Go enum. Legacy free/pro/enterprise are
// dropped; the entitlements reconciler rejects them as deprecated.
export const tenantTierSchema = z.enum([
  "solo",
  "squad",
  "org",
  "platform",
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
]);

export const agentModeSchema = z.enum(["autonomous", "supervised"]);

/**
 * Display names are human-visible and allow unicode + spaces, but reject
 * control characters and cap length to keep UI stable.
 */
export const displayNameSchema = z
  .string()
  .min(1, "display name must not be empty")
  .max(128, "display name exceeds 128 characters")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\x00-\x1f\x7f]*$/, "display name must not contain control characters");

// ---------------------------------------------------------------------------
// Per-action input schemas — one `strictObject` per exported action.
// Naming convention: {actionName}Input (camelCase, matches the action).
// ---------------------------------------------------------------------------

export const provisionTenantInput = z
  .object({
    displayName: displayNameSchema,
    owner: z.string().min(1, "owner is required"),
    tier: tenantTierSchema.optional(),
  })
  .strict();

export const deleteTenantInput = z
  .object({
    name: tenantNameSchema,
    confirmationText: z.string(),
  })
  .strict()
  .refine((v) => v.confirmationText === v.name, {
    message: "confirmation did not match tenant name",
    path: ["confirmationText"],
  });

export const updateTenantInput = z
  .object({
    name: tenantNameSchema,
    patch: z
      .object({
        tier: tenantTierSchema.optional(),
        displayName: displayNameSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const grantComponentInput = z
  .object({
    tenantName: tenantNameSchema,
    componentRef: componentRefSchema,
    source: z.enum(["admin", "tenant"]).optional(),
  })
  .strict();

export const revokeGrantInput = z
  .object({
    tenantName: tenantNameSchema,
    componentRef: componentRefSchema,
  })
  .strict();

export const inviteMemberInput = z
  .object({
    tenantName: tenantNameSchema,
    email: emailSchema,
    role: memberRoleSchema,
  })
  .strict();

export const acceptInvitationInput = z
  .object({
    tenantName: tenantNameSchema,
    memberName: dns1123Label,
    userId: z.string().min(1, "userId is required"),
  })
  .strict();

export const revokeMemberInput = z
  .object({
    tenantName: tenantNameSchema,
    memberName: dns1123Label,
  })
  .strict();

export const resendInvitationInput = z
  .object({
    tenantName: tenantNameSchema,
    memberName: dns1123Label,
  })
  .strict();

export const createEnrollmentInput = z
  .object({
    tenantName: tenantNameSchema,
    name: dns1123Label,
    agentName: dns1123Label,
    mode: agentModeSchema,
    componentGrants: z.array(componentRefSchema).optional(),
    notes: z.string().max(1024).optional(),
  })
  .strict();

export const revokeEnrollmentInput = z
  .object({
    tenantName: tenantNameSchema,
    name: dns1123Label,
  })
  .strict();

export const fetchBootstrapTokenInput = z
  .object({
    tenantName: tenantNameSchema,
    name: dns1123Label,
  })
  .strict();
