// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The Auth.js provider for Zitadel: generic OIDC, no Zitadel-specific plugin.
 *
 * It splits identity traffic in two (ADR-0092, dashboard#88):
 *
 *   - The BROWSER follows the authorization URL. It is on the public issuer.
 *   - The POD makes the code-for-token exchange and the userinfo call. They
 *     go to the in-cluster connect base, through `zitadelFetch`, which adds
 *     the instance header and refuses any other origin.
 *
 * All three endpoints are explicit, so Auth.js makes no discovery request.
 * A discovery document holds absolute URLs on the public host, and following
 * them from inside the pod is what once needed a hostAlias.
 *
 * The issuer stays the public string. Auth.js compares it with the `iss`
 * claim of the ID token and never dials it.
 */

import { customFetch } from "next-auth";
import type { NextAuthConfig } from "next-auth";

import { zitadelFetch } from "@/src/lib/zitadel/conn";

interface ZitadelProviderOptions {
  /** The public issuer: what the browser sees and what `iss` holds. */
  issuer: string;
  /** The in-cluster Zitadel Service base URL, with no trailing slash. */
  connectBase: string;
  clientId: string;
  clientSecret: string;
}

export function zitadelProvider(
  opts: ZitadelProviderOptions,
): NextAuthConfig["providers"][number] {
  return {
    // Provider id is kept as "zitadel" because it ends up in cookies
    // (next-auth.session-token, next-auth.callback-url) and rotating it
    // would invalidate every existing session. The display name is
    // "Identity", IdP branding never reaches users (the dashboard's
    // login page does its own redirect; Auth.js's built-in /api/auth/signin
    // page is not used).
    id: "zitadel",
    name: "Identity",
    type: "oidc",
    issuer: opts.issuer,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    // Request the openid, profile, and email scopes, plus the Zitadel
    // urn:zitadel:iam:user:resourceowner scope (ADR-0093 decision 4): it
    // adds the person's org id to the access token, which is the ONLY
    // input to tenant resolution (see stampSessionTenant in the jwt
    // callback in auth.ts). There is no client-asserted tenant claim.
    authorization: {
      url: `${opts.issuer}/oauth/v2/authorize`,
      params: {
        scope: "openid profile email urn:zitadel:iam:user:resourceowner",
        // Enforce PKCE for public clients even when a secret is present.
        code_challenge_method: "S256",
      },
    },
    token: `${opts.connectBase}/oauth/v2/token`,
    userinfo: `${opts.connectBase}/oidc/v1/userinfo`,
    [customFetch]: zitadelFetch,
    // Trust Zitadel's ID token claims directly; skip the userinfo endpoint
    // round-trip for name/email (auth.ts fetches them in the jwt callback).
    idToken: true,
    checks: ["pkce", "state"],
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.preferred_username ?? null,
        email: profile.email ?? null,
        image: profile.picture ?? null,
      };
    },
  };
}
