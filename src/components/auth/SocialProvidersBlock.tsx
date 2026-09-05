"use client";

/**
 * SocialProvidersBlock
 *
 * Presentational client component rendered above the email+password form on
 * the sign-in and sign-up pages. With Zitadel as the IdP, social providers
 * are now configured in Zitadel's hosted login page rather than the dashboard.
 *
 * This component always renders null, the `providers` prop is preserved for
 * forward-compat but is never non-empty from buildSocialProviders() in the
 * Zitadel flow. If per-provider IDP-hint buttons are desired in future, wire
 * them to signIn("zitadel", {}, { idp_hint: "<provider>" }).
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log.
 */

import type { ProviderId } from "@/src/lib/social-providers";

interface SocialProvidersBlockProps {
  /** Ordered list of enabled provider IDs, always empty in Zitadel flow. */
  providers: ProviderId[];
  /** Optional post-auth redirect destination, validated server-side. */
  redirectTo?: string;
  /** Controls the button label: "Continue with" vs "Sign up with". */
  mode: "signin" | "signup";
}

export function SocialProvidersBlock({
  providers,
}: SocialProvidersBlockProps) {
  // Render nothing, social IdPs surface through Zitadel's hosted login.
  if (!providers || providers.length === 0) return null;

  // If providers were somehow non-empty, still render nothing, this
  // component is awaiting a Zitadel IDP-hint implementation.
  return null;
}
