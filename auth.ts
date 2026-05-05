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

// TEST FIXTURE: fault-injection import — no-ops in production
// (single process.env check per call; zero overhead when not enabled).
import { getFaultMode } from "@/src/lib/test-fixtures/fault-injection";

// ---------------------------------------------------------------------------
// Module augmentation — extend the built-in Session/JWT types with the
// Zitadel tokens needed server-side. Tenant is intentionally NOT on the
// session: it lives in the separate `gibson_active_tenant` cookie managed
// by `src/lib/auth/active-tenant.ts`, which lets the user switch tenants
// without re-logging-in and lets membership changes take effect on the
// next request rather than at next sign-in.
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
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
      // Provider id is kept as "zitadel" because it ends up in cookies
      // (next-auth.session-token, next-auth.callback-url) and rotating it
      // would invalidate every existing session. The display name is
      // "Identity" — IdP branding never reaches users (the dashboard's
      // login page does its own redirect; Auth.js's built-in /api/auth/signin
      // page is not used).
      id: "zitadel",
      name: "Identity",
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
     * jwt — runs when the JWT is first created (sign-in) and on every
     * subsequent access. Stores ONLY stable user identity (sub, tokens) on
     * the encrypted cookie. Active tenant is NOT a session field — it
     * lives in `gibson_active_tenant` cookie (see active-tenant.ts) and
     * resolves per-request from FGA memberships.
     */
    async jwt({ token, account }) {
      // -----------------------------------------------------------------------
      // TEST FIXTURES: JWKS and token-exchange fault injection.
      // Only active when TEST_FIXTURES_ENABLED=true. These checks happen at
      // the start of the jwt callback — which Auth.js calls both on initial
      // sign-in (account is set) and on subsequent JWT refreshes (account is
      // undefined). We gate the fault checks on `account` being present so we
      // only intercept the initial sign-in flow, not every request that calls
      // auth() (which would break the session after fault arms).
      //
      // Fault effects:
      //   "token-exchange" fault → throw error that Auth.js maps to /login?error=...
      //     The middleware then intercepts the /login?error= URL and redirects
      //     to /login/error?reason=oidc_token_exchange_failed.
      //   "jwks" fault → same mechanism but with jwks_unavailable reason.
      //
      // In production: getFaultMode always returns undefined (env guard).
      // -----------------------------------------------------------------------
      if (account) {
        const tokenExchangeFault = getFaultMode("token-exchange");
        if (tokenExchangeFault) {
          tokenExchangeFault.decrementIfBounded();
          // Throwing in the jwt callback causes Auth.js to redirect to
          // pages.error (/login?error=Callback). The middleware or /login page
          // then redirects to /login/error?reason=oidc_token_exchange_failed.
          throw new Error("[fault-injection] token-exchange 503");
        }

        const jwksFault = getFaultMode("jwks");
        if (jwksFault) {
          jwksFault.decrementIfBounded();
          throw new Error("[fault-injection] jwks unavailable");
        }
      }
      // -----------------------------------------------------------------------

      if (account) {
        // account is populated only on the initial sign-in callback.
        // Copy the Zitadel access token into the encrypted JWT so that
        // gibson-client.ts can forward it as Authorization: Bearer on every
        // server-side gRPC call. The access token is never exposed to the
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
     * Server Actions. Exposes only user identity + server-side tokens; the
     * active tenant is intentionally absent (use getActiveTenant() instead).
     */
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
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
  //
  // Spec security-hardening R18 — pin the SESSION cookie to `sameSite: strict`
  // so it is never sent on cross-origin navigations. CSRF and clickjacking
  // attacks that rely on a third-party origin issuing GET/POST requests with
  // ambient session credentials cannot reach the dashboard's authenticated
  // endpoints.
  //
  // Trade-off: a user clicking a link to the dashboard FROM an external
  // origin (email, other site) will see the first request arrive
  // un-authenticated and be redirected to /login. After successful sign-in
  // the session cookie is set on the dashboard's own origin, after which
  // every subsequent same-origin navigation carries the cookie normally.
  //
  // CRITICAL: the OIDC state / PKCE / callback-URL cookies that Auth.js
  // sets during the sign-in round-trip are intentionally LEFT at their
  // default `sameSite: lax`. They MUST be lax so that Zitadel's
  // browser-level 302 redirect back to /api/auth/callback/zitadel includes
  // them — strict would block the redirect from carrying the state cookie,
  // breaking the entire sign-in flow. Auth.js v5's cookie defaults
  // (lib/utils/cookie.js) already set lax for these; we are NOT overriding
  // them here. Only `sessionToken` is overridden — the cookie that
  // represents an already-established session.
  // -------------------------------------------------------------------------
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "strict",
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
