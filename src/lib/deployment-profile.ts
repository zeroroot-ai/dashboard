/**
 * deployment-profile.ts — single source of truth for deployment posture.
 *
 * Open-core seam model (deploy ADR-0006, dashboard#920/#921): the dashboard
 * can run as a self-hosted install (card-free, no marketing site, optional
 * open registration) or as the ZeroRoot SaaS offering (billing wired, card-
 * first signup, marketing host). Three env knobs govern the split:
 *
 *   SIGNUP_SELF_SERVE              — set by the SaaS gitops overlay; absent =
 *                                    self-hosted (no self-serve signup path).
 *   DASHBOARD_BILLING_PAID_TIERS_ENABLED — "true"|"1" when the Stripe billing
 *                                    backend is wired (SaaS only).
 *   WWW_URL                        — full origin of the marketing host, e.g.
 *                                    https://www.zeroroot.ai. Absent on self-
 *                                    hosted (no marketing surface).
 *
 * THIS MODULE is the SOLE reader of those three knobs. All other surfaces read
 * the resolved `DeploymentProfile` object — never raw `process.env.*` for these
 * vars. That single-reader invariant is what makes "self-hosted can never show
 * a card" and "SaaS can never silently run unbilled" enforceable by inspection
 * rather than convention.
 *
 * Fail-closed: an incoherent combination (billing UI enabled while the platform
 * is not configured to require entitlements) throws a loud, descriptive error
 * rather than rendering a half-state. The check is deliberately conservative:
 * we require that if `billingEnabled` is true, `selfServeSignup` must also be
 * true (a billing-on install with no self-serve signup gate makes no sense —
 * users can never pay to sign up) and `marketingUrl` must be non-null (a
 * billing-on install with no marketing host is likely misconfigured).
 *
 * Resolved at RUNTIME (no NEXT_PUBLIC_* mirror; `import 'server-only'` enforces
 * the server-only boundary). The result is deploy-time-only — no request input
 * can change the resolved profile (continuing the gibson#1093 invariant).
 *
 * Usage in a Server Component or server action:
 *
 *   import { getDeploymentProfile } from '@/src/lib/deployment-profile';
 *   const profile = getDeploymentProfile();
 *   if (profile.billingEnabled) { ... }
 *
 * Never call in a Client Component. Pass resolved fields as props from the
 * nearest server boundary, exactly as billingEnabled() was used before.
 */

import 'server-only';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved deployment posture for this running instance.
 *
 * Every field is derived solely from deploy-time env knobs — never from
 * request headers, cookies, or query parameters.
 */
export interface DeploymentProfile {
  /**
   * True when self-serve signup is active (the SaaS profile or a self-hosted
   * install that has explicitly enabled open registration).
   *
   * When false, `/signup` redirects to `/login` and no "Create account" CTA
   * is shown — the install is login-only (admin-provisioned tenants).
   *
   * Derived from `SIGNUP_SELF_SERVE` (truthy = true, absent/falsy = false).
   */
  selfServeSignup: boolean;

  /**
   * True when the dashboard is wired to a Stripe-backed billing backend
   * (the hosted SaaS offering). False on self-hosted / on-prem (the default).
   *
   * When false: no Stripe checkout, no billing management UI, no upgrade CTAs.
   * Plan and entitlement display is not gated — that always shows.
   *
   * Derived from `DASHBOARD_BILLING_PAID_TIERS_ENABLED` ("true"|"1" = true).
   */
  billingEnabled: boolean;

  /**
   * Full origin of the marketing host (e.g. `https://www.zeroroot.ai`), or
   * null on self-hosted where there is no marketing surface.
   *
   * When null: no links to pricing pages, no marketing CTAs, no off-cluster
   * redirects. Any UI that would otherwise link to the marketing site omits the
   * link entirely rather than rendering a dead URL.
   *
   * Derived from `WWW_URL` (stripped of trailing slash).
   */
  marketingUrl: string | null;
}

// ---------------------------------------------------------------------------
// Incoherence detection
// ---------------------------------------------------------------------------

/**
 * Raised by `getDeploymentProfile()` when the resolved env knobs describe an
 * incoherent deployment posture. The message is operator-facing: it names the
 * conflicting knobs and the corrective action.
 */
export class IncoherentDeploymentProfileError extends Error {
  constructor(message: string) {
    super(
      `[deployment-profile] Incoherent deployment configuration — refusing to start.\n${message}`,
    );
    this.name = 'IncoherentDeploymentProfileError';
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the deployment posture from the three seam env knobs.
 *
 * Call once at the server boundary; pass the resulting object down as props
 * rather than calling this multiple times in a render tree.
 *
 * Throws `IncoherentDeploymentProfileError` for invalid knob combinations.
 * Valid combinations:
 *
 *   Self-hosted (OSS default):
 *     SIGNUP_SELF_SERVE unset, DASHBOARD_BILLING_PAID_TIERS_ENABLED absent/false,
 *     WWW_URL unset → { selfServeSignup: false, billingEnabled: false, marketingUrl: null }
 *
 *   Self-hosted with open registration:
 *     SIGNUP_SELF_SERVE=true, DASHBOARD_BILLING_PAID_TIERS_ENABLED absent/false,
 *     WWW_URL unset → { selfServeSignup: true, billingEnabled: false, marketingUrl: null }
 *
 *   SaaS:
 *     SIGNUP_SELF_SERVE=true, DASHBOARD_BILLING_PAID_TIERS_ENABLED=true,
 *     WWW_URL=https://www.zeroroot.ai
 *     → { selfServeSignup: true, billingEnabled: true, marketingUrl: 'https://www.zeroroot.ai' }
 *
 * @param source - env override; defaults to `process.env`. Tests inject their
 *   own records here so they do not mutate the real process environment.
 */
export function getDeploymentProfile(
  source: Record<string, string | undefined> = process.env,
): DeploymentProfile {
  const selfServeSignup = !!(source['SIGNUP_SELF_SERVE']);

  const billingRaw = source['DASHBOARD_BILLING_PAID_TIERS_ENABLED'];
  const billingEnabled = billingRaw === 'true' || billingRaw === '1';

  const wwwRaw = source['WWW_URL'];
  const marketingUrl = wwwRaw ? wwwRaw.replace(/\/$/, '') : null;

  // ---- Incoherence checks ----

  // billing-on without self-serve signup: a pay-to-sign-up flow requires an
  // accessible signup gate. A billing-on + no-signup install has no way to
  // onboard new paying users — it is almost certainly a misconfiguration.
  if (billingEnabled && !selfServeSignup) {
    throw new IncoherentDeploymentProfileError(
      'DASHBOARD_BILLING_PAID_TIERS_ENABLED is true but SIGNUP_SELF_SERVE is unset.\n' +
        'A billing-enabled install requires an accessible signup path.\n' +
        'Fix: set SIGNUP_SELF_SERVE=true in the SaaS overlay, or disable billing ' +
        '(unset DASHBOARD_BILLING_PAID_TIERS_ENABLED) for a self-hosted install.',
    );
  }

  // billing-on without a marketing URL: the SaaS billing flow redirects users
  // to the marketing pricing page for plan selection. Without WWW_URL, the
  // redirect target is unknown and the flow is broken.
  if (billingEnabled && !marketingUrl) {
    throw new IncoherentDeploymentProfileError(
      'DASHBOARD_BILLING_PAID_TIERS_ENABLED is true but WWW_URL is unset.\n' +
        'The SaaS billing flow requires a marketing host for plan selection redirects.\n' +
        'Fix: set WWW_URL=https://www.your-marketing-host.example in the SaaS overlay, ' +
        'or disable billing (unset DASHBOARD_BILLING_PAID_TIERS_ENABLED) for a self-hosted install.',
    );
  }

  return { selfServeSignup, billingEnabled, marketingUrl };
}
