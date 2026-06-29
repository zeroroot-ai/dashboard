/**
 * Social provider configuration shim.
 *
 * With Auth.js v5 + Zitadel, the dashboard no longer handles individual
 * OAuth provider flows. All social sign-in (GitHub, GitLab, Google, Microsoft)
 * is configured as identity providers directly in Zitadel. The dashboard
 * presents a single "Continue with Zitadel" button that routes through the
 * Zitadel-hosted login page, which in turn shows the configured social IdPs.
 *
 * This module is retained as a typed stub so the login page and signup form
 * can continue to import ProviderId / PROVIDER_ORDER / buildSocialProviders
 * without breaking. The enabled list is always empty in this implementation
 * because the social buttons are now rendered by Zitadel, not the dashboard.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log. If per-provider buttons in the dashboard UI are
 * desired in future, map them to Auth.js signIn("zitadel", {}, { idp_hint: "<provider>" })
 * using Zitadel's IDP hint parameter.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** All provider identifiers supported by this build. */
export type ProviderId = "github" | "gitlab" | "google" | "microsoft";

/** Canonical display order, UI renders buttons in this sequence. */
export const PROVIDER_ORDER: ProviderId[] = ["github", "gitlab", "google", "microsoft"];

interface SocialProvidersResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  /**
   * Ordered list of provider IDs that are enabled (have full credentials).
   * Always empty, social IdPs are configured in Zitadel, not the dashboard.
   */
  enabled: ProviderId[];
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Returns an empty providers result. Social sign-in flows are now handled
 * entirely by Zitadel's hosted login page.
 */
export function buildSocialProviders(): SocialProvidersResult {
  return { config: {}, enabled: [] };
}
