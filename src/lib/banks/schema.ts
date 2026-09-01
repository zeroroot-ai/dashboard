/**
 * Bank form and request schemas (gibson#1706 lane E1).
 *
 * One schema serves the create form (through zodResolver) and the POST
 * route (through safeParse), so the browser and the route refuse the same
 * inputs the daemon store refuses (gibson#1726): a subscription bank owned by
 * the tenant, and a third-party shape with no provider configuration.
 */

import { z } from "zod";
import { LOGIN_SHAPES, SPILL_POLICIES, shapeNeedsProviderConfig } from "./view";

const count = z.coerce.number().int().min(0, "Must be zero or more");

export const createBankSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    tenantOwned: z.boolean(),
    desiredCount: count,
    loginShape: z.enum(LOGIN_SHAPES as [string, ...string[]]),
    providerConfigName: z.string().trim(),
    agentName: z.string().trim().max(120),
    model: z.string().trim().max(200),
    maxJobsInFlight: count,
    /** Minutes in the form. Zero means the daemon default. */
    staleLimitMinutes: count,
    spillPolicy: z.enum(SPILL_POLICIES as [string, ...string[]]),
  })
  .superRefine((v, ctx) => {
    if (v.loginShape === "subscription" && v.tenantOwned) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loginShape"],
        message: "A subscription belongs to a person. A tenant-owned bank needs an API key or a cloud credential.",
      });
    }
    if (shapeNeedsProviderConfig(v.loginShape as never) && v.providerConfigName === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConfigName"],
        message: "Pick the provider configuration that holds the credential.",
      });
    }
  });

export type CreateBankFormValues = z.infer<typeof createBankSchema>;

export const updateBankSchema = z.object({
  desiredCount: count.optional(),
  maxJobsInFlight: count.optional(),
  staleLimitMinutes: count.optional(),
  spillPolicy: z.enum(SPILL_POLICIES as [string, ...string[]]).optional(),
});

export type UpdateBankFormValues = z.infer<typeof updateBankSchema>;
