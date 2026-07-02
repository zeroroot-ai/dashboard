/**
 * billing-enabled.ts — thin shim over the deployment-profile resolver.
 *
 * Open-core context (ADR-0050, dashboard#809): gibson#798 ripped
 * BillingService / Stripe / plans out of the OSS daemon; the closed billing
 * implementation lives in the (future) closed billing layer. On-prem /
 * self-host runs WITHOUT billing — it operates on the config-driven
 * Entitlements default. The hosted offering wires in the closed billing
 * service.
 *
 * dashboard#921: the authoritative reader of `DASHBOARD_BILLING_PAID_TIERS_ENABLED`
 * (and the other posture knobs) has moved to `src/lib/deployment-profile.ts`.
 * This file is retained as a convenience shim so existing callers that only
 * need the `billingEnabled` boolean do not have to change their import paths.
 * New callers that need multiple profile fields should import
 * `getDeploymentProfile()` directly and destructure what they need.
 *
 * Fail-closed: an absent / unrecognised value means billing is OFF. This is
 * the on-prem default — a self-host deploy that simply doesn't set the var
 * gets the no-billing surface, never a half-wired checkout that 500s.
 *
 * Server-only: the flag is read at RUNTIME (the shared :main image can't bake
 * a per-env value, same reasoning as STRIPE_PUBLISHABLE_KEY in
 * env-validator.ts). Client components receive the resolved boolean as a prop
 * from their nearest server boundary — do NOT add a NEXT_PUBLIC_* mirror.
 */

import 'server-only';

import { getDeploymentProfile } from '@/src/lib/deployment-profile';

/**
 * True when the dashboard is wired to a Stripe-backed billing backend
 * (hosted offering). False on-prem / self-host (the default).
 *
 * Delegates to `getDeploymentProfile().billingEnabled`. Prefer calling
 * `getDeploymentProfile()` directly when you also need `selfServeSignup`
 * or `marketingUrl` — that avoids resolving the profile twice.
 */
export function billingEnabled(): boolean {
  return getDeploymentProfile().billingEnabled;
}
