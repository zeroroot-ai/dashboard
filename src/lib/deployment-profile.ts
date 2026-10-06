// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * deployment-profile.ts — single source of truth for deployment posture.
 *
 * Open-core seam model (ADR-0074, dashboard#920/#921): the dashboard
 * can run as a self-hosted install (no marketing site, optional open
 * registration) or as the ZeroRoot SaaS offering (marketing host, account
 * link, external signup step). These env knobs govern the split:
 *
 *   SIGNUP_SELF_SERVE              — set by the SaaS gitops overlay; absent =
 *                                    self-hosted (no self-serve signup path).
 *   WWW_URL                        — full origin of the marketing host, e.g.
 *                                    https://www.zeroroot.ai. Absent on self-
 *                                    hosted (no marketing surface).
 *   DASHBOARD_ACCOUNT_URL and DASHBOARD_ACCOUNT_LINK_LABEL
 *                                  — the account link of the settings area.
 *   DASHBOARD_SIGNUP_STEP_*        — the texts of the external signup step.
 *
 * The dashboard holds no billing code (ADR-0060, D54). A private component
 * connects through two neutral points: the account URL, and the signup step.
 * The daemon owns the step URL and returns it from Signup (gibson#895). The
 * dashboard owns only the texts, and the source holds no default for them.
 *
 * THIS MODULE is the SOLE reader of those knobs. All other surfaces read the
 * resolved `DeploymentProfile` object — never raw `process.env.*` for these
 * vars.
 *
 * Fail-closed: an incoherent combination (a URL with no label, or some step
 * texts with others missing) throws a loud, descriptive error rather than
 * rendering a half-state.
 *
 * Resolved at RUNTIME (no NEXT_PUBLIC_* mirror; `import 'server-only'` enforces
 * the server-only boundary). The result is deploy-time-only — no request input
 * can change the resolved profile (continuing the gibson#1093 invariant).
 *
 * Usage in a Server Component or server action:
 *
 *   import { getDeploymentProfile } from '@/src/lib/deployment-profile';
 *   const profile = getDeploymentProfile();
 *   if (profile.selfServeSignup) { ... }
 *
 * Never call in a Client Component. Pass resolved fields as props from the
 * nearest server boundary.
 */

import 'server-only';

import { resolveDocsOrigin } from '@/src/lib/host-routing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved deployment posture for this running instance.
 *
 * Every field is derived solely from deploy-time env knobs — never from
 * request headers, cookies, or query parameters.
 */
interface DeploymentProfile {
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

  /**
   * Full origin of the docs site, no trailing slash. Never null.
   *
   * Docs are their own deployable on their own host, in BOTH audiences
   * (ADR-0074 classes them a core component), so unlike `marketingUrl` there
   * is always somewhere real for a /docs link to land. That is precisely why
   * docs must never be addressed as a path under `marketingUrl`: the
   * marketing site serves no /docs and answers 404.
   *
   * Derived from `DOCS_URL` by `resolveDocsOrigin`, which the host split
   * shares so the two cannot disagree.
   */
  docsUrl: string;

  /**
   * The account link of the settings area, or null when no account URL is
   * set. Only the tenant Owner sees it. The service behind the URL checks the
   * role again, so the hidden link is a convenience, not the control.
   *
   * Derived from `DASHBOARD_ACCOUNT_URL` and `DASHBOARD_ACCOUNT_LINK_LABEL`.
   */
  accountLink: AccountLink | null;

  /**
   * The texts of the external signup step, or null when none is set. The
   * daemon decides whether a signup has a step. When it returns one and these
   * texts are null, the signup fails with an operator-facing log line.
   *
   * Derived from the six `DASHBOARD_SIGNUP_STEP_*` variables.
   */
  signupStepText: SignupStepText | null;
}

/** The account link: a URL and the label that the settings area shows. */
export interface AccountLink {
  url: string;
  label: string;
}

/** The texts of the external signup step. All of them come from config. */
export interface SignupStepText {
  title: string;
  text: string;
  buttonLabel: string;
  waitingText: string;
  failureText: string;
  retryLabel: string;
}

/** Env name of each signup step text, for the error message. */
const SIGNUP_STEP_TEXT_ENV: Record<keyof SignupStepText, string> = {
  title: 'DASHBOARD_SIGNUP_STEP_TITLE',
  text: 'DASHBOARD_SIGNUP_STEP_TEXT',
  buttonLabel: 'DASHBOARD_SIGNUP_STEP_BUTTON_LABEL',
  waitingText: 'DASHBOARD_SIGNUP_STEP_WAITING_TEXT',
  failureText: 'DASHBOARD_SIGNUP_STEP_FAILURE_TEXT',
  retryLabel: 'DASHBOARD_SIGNUP_STEP_RETRY_LABEL',
};

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
 * Resolve the deployment posture from the seam env knobs.
 *
 * Call once at the server boundary; pass the resulting object down as props
 * rather than calling this multiple times in a render tree.
 *
 * Throws `IncoherentDeploymentProfileError` for invalid knob combinations:
 * a URL with no label, a label with no URL, or a partial set of step texts.
 *
 * @param source - env override; defaults to `process.env`. Tests inject their
 *   own records here so they do not mutate the real process environment.
 */
export function getDeploymentProfile(
  source: Record<string, string | undefined> = process.env,
): DeploymentProfile {
  const selfServeSignup = !!(source['SIGNUP_SELF_SERVE']);

  const wwwRaw = source['WWW_URL'];
  const marketingUrl = wwwRaw ? wwwRaw.replace(/\/$/, '') : null;

  // Dotted reads on purpose: check-env-declared-is-read counts `env.X` as the
  // reader of each declared name.
  const env = source;
  const accountUrl = (env.DASHBOARD_ACCOUNT_URL ?? '').trim();
  const accountLabel = (env.DASHBOARD_ACCOUNT_LINK_LABEL ?? '').trim();
  if ((accountUrl === '') !== (accountLabel === '')) {
    throw new IncoherentDeploymentProfileError(
      'DASHBOARD_ACCOUNT_URL and DASHBOARD_ACCOUNT_LINK_LABEL must be set together.\n' +
        'Fix: set both for an install with an account service, or neither.',
    );
  }
  const accountLink = accountUrl ? { url: accountUrl, label: accountLabel } : null;

  const stepText: SignupStepText = {
    title: (env.DASHBOARD_SIGNUP_STEP_TITLE ?? '').trim(),
    text: (env.DASHBOARD_SIGNUP_STEP_TEXT ?? '').trim(),
    buttonLabel: (env.DASHBOARD_SIGNUP_STEP_BUTTON_LABEL ?? '').trim(),
    waitingText: (env.DASHBOARD_SIGNUP_STEP_WAITING_TEXT ?? '').trim(),
    failureText: (env.DASHBOARD_SIGNUP_STEP_FAILURE_TEXT ?? '').trim(),
    retryLabel: (env.DASHBOARD_SIGNUP_STEP_RETRY_LABEL ?? '').trim(),
  };
  const stepKeys = Object.keys(stepText) as Array<keyof SignupStepText>;
  const missing = stepKeys.filter((key) => stepText[key] === '');
  if (missing.length > 0 && missing.length < stepKeys.length) {
    throw new IncoherentDeploymentProfileError(
      `The signup step texts are set in part. Missing: ${missing
        .map((key) => SIGNUP_STEP_TEXT_ENV[key])
        .join(', ')}.\n` + 'Fix: set all six DASHBOARD_SIGNUP_STEP_* texts, or none.',
    );
  }
  const signupStepText = missing.length === 0 ? stepText : null;

  return {
    selfServeSignup,
    marketingUrl,
    docsUrl: resolveDocsOrigin(source),
    accountLink,
    signupStepText,
  };
}
