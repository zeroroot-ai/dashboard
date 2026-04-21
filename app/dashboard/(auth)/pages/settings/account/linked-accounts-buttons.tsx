"use client";

/**
 * LinkedAccountsButtons — stub (social account linking migrated to Zitadel).
 *
 * Social account linking/unlinking is now managed through Zitadel's user
 * profile UI rather than the dashboard. This component renders nothing.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log. The previous linkSocialAction / unlinkSocialAction are
 * superseded by Zitadel's identity provider linking API (task 25+).
 */

import type { ProviderId } from "@/src/lib/social-providers";

interface LinkedAccountsButtonsProps {
  provider: ProviderId;
  isLinked: boolean;
  isLastCredential: boolean;
}

export function LinkedAccountsButtons(_props: LinkedAccountsButtonsProps) {
  // Social IdP linking is managed in Zitadel's profile UI.
  return null;
}
