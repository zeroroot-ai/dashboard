/**
 * LinkedAccountsSection — renders nothing in Zitadel mode.
 *
 * Social account linking is now managed through Zitadel's user profile UI.
 * The dashboard no longer manages per-provider account linking.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log. Could link to Zitadel's profile URL for the user to
 * manage their linked IdPs.
 */

import { buildSocialProviders } from "@/src/lib/social-providers";

export async function LinkedAccountsSection() {
  const { enabled } = buildSocialProviders();

  // No social providers in Zitadel mode — render nothing.
  if (enabled.length === 0) return null;

  return null;
}
