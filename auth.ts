/**
 * Auth.js v5 (next-auth) singleton for Gibson Dashboard.
 *
 * Implements a vanilla OIDC Relying Party against Zitadel using the generic
 * OIDC provider — no Zitadel-specific plugin, no vendor lock-in.
 *
 * Environment variables (all required in production):
 *   AUTH_SECRET          — random 32+ char secret (Helm: randAlphaNum 32, mounted via K8s Secret)
 *   ZITADEL_ISSUER       — OIDC issuer base URL  (default: https://auth.zero-day.local for Kind dev)
 *   ZITADEL_CLIENT_ID    — registered OIDC client ID (set by Helm post-install Job, task 2)
 *   ZITADEL_CLIENT_SECRET — OIDC client secret; may be empty for PKCE-only public clients
 *
 * The dashboard client was registered as a public PKCE client (auth method NONE),
 * so ZITADEL_CLIENT_SECRET is optional — Auth.js will omit the client_secret_basic
 * flow when the secret is absent.
 *
 * Session strategy: "jwt" — Auth.js signs an encrypted JWT cookie; no server-side
 * session DB required. The cookie carries the gibson:tenant claim forwarded from
 * Zitadel's custom claim Action (task 2).
 *
 * Exports follow Auth.js v5 conventions:
 *   handlers  — { GET, POST } — wire into app/api/auth/[...nextauth]/route.ts (task 22)
 *   auth      — session resolver for Server Components and Server Actions
 *   signIn    — server-side sign-in redirect helper
 *   signOut   — server-side sign-out redirect helper
 */

import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

// ---------------------------------------------------------------------------
// Module augmentation — extend the built-in Session/JWT types with the
// gibson:tenant claim so callers get type-safe access to session.user.tenant.
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /** Zitadel project-scoped tenant ID injected via the gibson:tenant claim Action */
      tenant?: string;
    };
    /**
     * Zitadel access token forwarded from the OIDC token endpoint.
     * Exposed server-side only — never serialised to the client.
     * Used by gibson-client.ts to set Authorization: Bearer <accessToken>.
     */
    accessToken?: string;
    /**
     * Raw Zitadel ID token — required as `id_token_hint` on the
     * end_session_endpoint during federated logout. Server-side only.
     */
    idToken?: string;
  }

  interface JWT {
    /** Forwarded from the OIDC ID token gibson:tenant claim */
    tenant?: string;
    /** Raw Zitadel access token — stored in the encrypted JWT cookie, server-side only */
    accessToken?: string;
    /** Raw Zitadel ID token — stored in the encrypted JWT cookie, server-side only */
    idToken?: string;
  }
}

// ---------------------------------------------------------------------------
// Environment variable resolution
// ---------------------------------------------------------------------------
// The issuer is what the BROWSER sees (used for OIDC authorize redirects + what
// Zitadel puts in the `iss` claim of issued tokens).
const issuer =
  process.env.ZITADEL_ISSUER ?? "https://auth.zero-day.local";

// The internal issuer is what the DASHBOARD POD uses to fetch OIDC discovery
// and exchange the authorization code for tokens. In the production deploy
// this is the SAME URL the browser sees — the pod resolves the public
// hostname to Envoy's pinned ClusterIP via Kubernetes hostAliases, so server-
// and browser-side calls hit the same authority and Zitadel mints a single
// consistent issuer claim. The env var stays as an override hatch for any
// environment where the two URLs MUST diverge (rare).
const internalIssuer =
  process.env.ZITADEL_INTERNAL_ISSUER ?? issuer;

const clientId = process.env.ZITADEL_CLIENT_ID ?? "";

// Public PKCE clients have no secret. Auth.js skips client_secret_basic when
// clientSecret is an empty string, which is the correct behaviour for PKCE.
const clientSecret = process.env.ZITADEL_CLIENT_SECRET ?? "";

// ---------------------------------------------------------------------------
// Auth.js configuration
// ---------------------------------------------------------------------------
const config: NextAuthConfig = {
  // -------------------------------------------------------------------------
  // Provider — generic OIDC, NOT a Zitadel-specific plugin.
  // Auth.js v5 accepts an inline OIDCConfig object directly; the wellKnown
  // field causes it to auto-discover all endpoints from Zitadel's discovery
  // document, so we never need to hard-code token/userinfo/jwks URLs.
  // -------------------------------------------------------------------------
  providers: [
    {
      id: "zitadel",
      name: "Zitadel",
      type: "oidc",
      issuer,
      wellKnown: `${internalIssuer}/.well-known/openid-configuration`,
      clientId,
      clientSecret: clientSecret || undefined,
      // Request the openid, profile, and email scopes. The gibson:tenant claim
      // is injected server-side by Zitadel's custom Action and arrives in the
      // ID token without a dedicated scope.
      authorization: {
        params: {
          scope: "openid profile email",
          // Enforce PKCE for public clients even when a secret is present.
          code_challenge_method: "S256",
        },
      },
      // Trust Zitadel's ID token claims directly; skip the userinfo endpoint
      // round-trip so the gibson:tenant claim from the ID token is available
      // in the jwt callback without a second network call.
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
    },
  ],

  // -------------------------------------------------------------------------
  // Session — JWT strategy (no DB required; cookie-based, encrypted by Auth.js)
  // -------------------------------------------------------------------------
  session: {
    strategy: "jwt",
    // 8 hours; matches a typical working-session duration. The Zitadel token
    // lifetime is shorter — Auth.js will re-mint the JWT on each server render
    // while the OIDC session remains valid.
    maxAge: 8 * 60 * 60,
  },

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------
  callbacks: {
    /**
     * jwt — runs when the JWT is first created (sign-in) and on every subsequent
     * access. Copies the `gibson:tenant` claim from the Zitadel ID token into
     * the Auth.js JWT so it survives session refreshes.
     */
    async jwt({ token, account, profile }) {
      if (account && profile) {
        // account is populated only on the initial sign-in callback.
        // profile contains the raw ID token claims from Zitadel.
        const claims = profile as Record<string, unknown>;

        // Tenant resolution — single, documented precedence:
        //   1. `gibson:tenant` — emitted by a future Zitadel Actions v2
        //      mapper. When wired, it is authoritative.
        //   2. `urn:zitadel:iam:user:resourceowner:id` — the user's Zitadel
        //      org ID. Post dashboard-native-signup, EVERY real user lives
        //      in their own Zitadel org (created by the tenant-operator's
        //      EnsureZitadelOrg saga step), and that org's ID IS the tenant
        //      ID. The chart's FGA tuples are written keyed on the same
        //      value, so this path is end-to-end consistent.
        const gibsonTenant = claims["gibson:tenant"];
        const resourceOwnerId = claims["urn:zitadel:iam:user:resourceowner:id"];
        token["tenant"] =
          (typeof gibsonTenant === "string" && gibsonTenant.length > 0
            ? gibsonTenant
            : typeof resourceOwnerId === "string" && resourceOwnerId.length > 0
              ? resourceOwnerId
              : undefined);

        // Copy the Zitadel access token into the encrypted JWT so that
        // gibson-client.ts can forward it as Authorization: Bearer on every
        // server-side gRPC call.  The access token is never exposed to the
        // browser — it lives only in the encrypted HttpOnly cookie.
        if (typeof account.access_token === "string") {
          token["accessToken"] = account.access_token;
        }
        // Stash the ID token too — Zitadel's end_session_endpoint requires
        // it as `id_token_hint` to perform federated logout (sign the user
        // out of Zitadel, not just the dashboard's own cookie).
        if (typeof account.id_token === "string") {
          token["idToken"] = account.id_token;
        }
      }
      return token;
    },

    /**
     * session — shapes the session object returned to client components and
     * Server Actions. Exposes the tenant from the JWT.
     */
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      if (typeof token["tenant"] === "string") {
        session.user.tenant = token["tenant"];
      }
      // Forward the Zitadel access token to server-side callers (gibson-client.ts).
      // This field is set on the Session type but is never included in the
      // client-visible session payload — it is only available inside Server
      // Components and Server Actions where auth() is called server-side.
      if (typeof token["accessToken"] === "string") {
        session.accessToken = token["accessToken"];
      }
      // Same treatment for the ID token — needed server-side by the
      // federated-signout route (/api/auth/federated-signout) so it can
      // pass id_token_hint to Zitadel's end_session_endpoint.
      if (typeof token["idToken"] === "string") {
        session.idToken = token["idToken"];
      }
      return session;
    },

    /**
     * authorized — invoked by Auth.js middleware (task 22) to gate protected
     * routes. Returning false causes Auth.js to redirect to the sign-in page.
     * Public routes (sign-in page itself, health endpoints) are excluded in the
     * middleware matcher config, not here — keep this callback simple.
     */
    async authorized({ auth }) {
      return !!auth?.user;
    },
  },

  // -------------------------------------------------------------------------
  // Cookie configuration
  // -------------------------------------------------------------------------
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  // -------------------------------------------------------------------------
  // Pages — the dashboard's branded sign-in shell lives at /login (a Server
  // Component that hands off to Zitadel via next-auth's signIn() in useEffect,
  // so users never see a stock Auth.js page). Errors route back to /login
  // with an `error` query param, letting the same shell surface them in the
  // dashboard's own theme.
  // -------------------------------------------------------------------------
  pages: {
    signIn: "/login",
    error: "/login",
  },
};

// ---------------------------------------------------------------------------
// Export the Auth.js singleton using v5 named-export conventions.
// handlers → task 22 (route handler)
// auth      → Server Components, Server Actions, middleware
// signIn    → server-side redirect helper
// signOut   → server-side redirect helper
// ---------------------------------------------------------------------------
export const { handlers, auth, signIn, signOut } = NextAuth(config);
