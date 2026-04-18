/**
 * Better Auth server configuration for Gibson Dashboard.
 *
 * This is the single source of truth for authentication on the server side.
 * It configures Better Auth with:
 * - PostgreSQL adapter (via DATABASE_URL)
 * - Email and password authentication
 * - Organization plugin (with teams)
 * - Session cookie caching (maxAge 300s)
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string to gibson-dashboard-postgresql
 * - BETTER_AUTH_SECRET: Secret for signing session tokens (shared with daemon)
 * - BETTER_AUTH_URL: Base URL of the dashboard (e.g. https://dashboard.example.com)
 */

import { betterAuth, type User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { Pool } from "pg";

import { emitAuthAudit } from "@/src/lib/audit/auth";
import { isPasswordBreached } from "@/src/lib/auth/hibp";
import { getEmailProvider } from "@/src/lib/email/provider";
import { render as renderResetEmail } from "@/src/lib/email/templates/reset";
import { render as renderVerifyEmail } from "@/src/lib/email/templates/verify";
import { hibpChecks } from "@/src/lib/metrics/auth";
import { runGrandfatherEmailVerifiedMigration } from "@/src/lib/migrations/2026-04-grandfather-email-verified";
import { runSocialProviderProfileMigration } from "@/src/lib/migrations/2026-04-social-provider-profile";
import { validateBillingConfig } from "@/src/lib/billing/stripe";
import { buildSocialProviders } from "@/src/lib/social-providers";
import { createPersonalOrg } from "@/src/lib/auth/create-personal-org";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error(
    "[auth-server] BETTER_AUTH_SECRET environment variable is required. " +
      "Set it in your deployment configuration. " +
      "It must match the BETTER_AUTH_SECRET configured in the Gibson daemon."
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[auth-server] DATABASE_URL environment variable is required. " +
      "Set it to the PostgreSQL connection string for gibson-dashboard-postgresql."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const debug = process.env.DASHBOARD_DEBUG === "1";

// ---------------------------------------------------------------------------
// Session TTL + cookie security.
//
// Better Auth semantics:
//   * `session.expiresIn`   — absolute max lifetime of a session (hard ceiling).
//   * `session.updateAge`   — idle refresh window; after this many seconds since
//                              last activity the session cookie is rotated on
//                              the next authenticated request.
// Env overrides let ops tune without a redeploy. Defaults align with Task 16
// (requirement 11): idle 24h, absolute 30d.
// ---------------------------------------------------------------------------
const DEFAULT_SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const DEFAULT_SESSION_IDLE_SECONDS = 60 * 60 * 24; // 24 hours

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[auth-server] ${name}='${raw}' is not a positive integer; using default ${fallback}s`
    );
    return fallback;
  }
  return parsed;
}

const sessionAbsoluteSeconds = parsePositiveIntEnv(
  "DASHBOARD_SESSION_ABSOLUTE_SECONDS",
  DEFAULT_SESSION_ABSOLUTE_SECONDS
);
const sessionIdleSeconds = parsePositiveIntEnv(
  "DASHBOARD_SESSION_IDLE_SECONDS",
  DEFAULT_SESSION_IDLE_SECONDS
);

// Secure flag: required in real deployments; opt-in locally so `kind`-based
// dev clusters serving over plain http can still set-cookie. Forcing via
// DASHBOARD_FORCE_SECURE_COOKIES=true lets staging pin Secure without
// flipping NODE_ENV.
const isProductionEnv =
  process.env.NODE_ENV === "production" ||
  process.env.DASHBOARD_FORCE_SECURE_COOKIES === "true";

const authOptions = {
  database: pool,

  secret: process.env.BETTER_AUTH_SECRET,

  baseURL: process.env.BETTER_AUTH_URL ?? undefined,

  // In debug mode, log every Better Auth decision (route, validation,
  // hook outcomes) so operators can diagnose signup / org / session
  // failures without redeploying. Default OFF.
  logger: debug
    ? { level: "debug" as const, disabled: false }
    : { level: "info" as const, disabled: false },

  // Social provider configuration — reads {PROVIDER}_{CLIENT_ID,CLIENT_SECRET}
  // (and MICROSOFT_TENANT_ID for Entra ID) from env at startup. Throws when a
  // provider is partially configured so misconfigs surface in CI, not in prod.
  // Returns an empty config when no provider env vars are set — zero regression
  // against the email+password-only default.
  socialProviders: buildSocialProviders().config,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // Phase B of auth-flow-hardening: block sign-in for users who haven't
    // verified their email. Combined with the dashboard layout redirect to
    // `/verify-email` (Wave 3), this enforces verification before any
    // authenticated request reaches a protected page. Pre-existing users are
    // grandfathered in by the migration at the bottom of this file so no
    // existing user is locked out on deploy.
    requireEmailVerification: true,
    // Password-reset token TTL. Shorter than the verification TTL because a
    // reset flow should be completed quickly — a stale reset link is a risk
    // surface (link-leak via shoulder-surfed inbox, forwarded email, etc.).
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    // Invalidate every existing session for the user when they successfully
    // reset their password. If an attacker triggered the reset via an
    // already-compromised session, this forces them out.
    revokeSessionsOnPasswordReset: true,
    // Dispatches the password-reset email through the configured provider.
    // Uses the same template module the claim/verify flows use so branding
    // and escaping are consistent across transactional mail. Fire-and-forget
    // audit is emitted here (not in the caller) so every distinct send is
    // recorded regardless of which code path requested it.
    sendResetPassword: async ({
      user,
      url,
    }: {
      user: { id: string; email: string };
      url: string;
      token: string;
    }) => {
      const msg = renderResetEmail({
        email: user.email,
        resetUrl: url,
        expiresInHours: 1,
      });
      try {
        await getEmailProvider().send(msg);
        emitAuthAudit({
          action: "password_reset_requested",
          outcome: "ok",
          userId: user.id,
        });
      } catch (err) {
        // Log + re-throw: Better Auth will surface the error to the caller,
        // which then returns the enumeration-resistant generic success to the
        // user. The audit trail still captures the failure for ops review.
        emitAuthAudit({
          action: "password_reset_requested",
          outcome: "failed",
          userId: user.id,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  },

  // Email verification config — Better Auth drives token generation, URL
  // construction, and the `/verify-email` endpoint. Our job is to dispatch
  // the email and emit the audit event.
  //
  // `DASHBOARD_EMAIL_PROVIDER=log` (the default for local `kind` clusters)
  // routes the message to stdout via `LogEmailProvider`, so nothing leaves
  // the pod during dev. Production deployments set `resend` or `smtp`.
  emailVerification: {
    // 24 hours — tokens expiring sooner are easy to miss (signup at bedtime,
    // click the link the next morning). Longer than reset because there's no
    // "password" live behind the token — worst case is a re-verification.
    expiresIn: 24 * 60 * 60,
    // Kick off the verification email the moment a new account is created.
    // Combined with `emailAndPassword.requireEmailVerification`, this is what
    // makes every new dashboard user land on `/verify-email` until they
    // click the link.
    sendOnSignUp: true,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { id: string; email: string };
      url: string;
      token: string;
    }) => {
      const msg = renderVerifyEmail({
        email: user.email,
        verificationUrl: url,
        expiresInHours: 24,
      });
      try {
        await getEmailProvider().send(msg);
        emitAuthAudit({
          action: "email_verification_requested",
          outcome: "ok",
          userId: user.id,
        });
      } catch (err) {
        emitAuthAudit({
          action: "email_verification_requested",
          outcome: "failed",
          userId: user.id,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  },

  session: {
    // Absolute ceiling — session cannot live longer than this even with
    // continuous activity. Default 30d, override via
    // DASHBOARD_SESSION_ABSOLUTE_SECONDS.
    expiresIn: sessionAbsoluteSeconds,
    // Idle refresh window — after this long without activity the cookie
    // rotates on the next request. Default 24h, override via
    // DASHBOARD_SESSION_IDLE_SECONDS.
    updateAge: sessionIdleSeconds,
    cookieCache: {
      enabled: true,
      maxAge: 300, // 5 minutes — short enough to stay fresh, long enough to avoid DB on every request
    },
  },

  // Cookie hardening — applied to every cookie Better Auth sets
  // (session_token, dont_remember, etc.).
  //   * `cookiePrefix: 'gibson'` scopes our cookies so collisions with other
  //     apps on the same parent domain are impossible.
  //   * `httpOnly: true` makes the cookie unreadable from JS (defence against
  //     XSS exfiltration).
  //   * `sameSite: 'lax'` blocks CSRF on top-level cross-site POSTs while
  //     still allowing normal navigation-based sign-in.
  //   * `secure` is pinned on in production and configurable via
  //     DASHBOARD_FORCE_SECURE_COOKIES so staging and prod can't
  //     accidentally issue cookies over plain http.
  advanced: {
    cookiePrefix: "gibson",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProductionEnv,
    },
  },

  // Account linking policy — controls how social sign-ins are auto-linked to
  // existing user rows.
  //
  // LOAD-BEARING (account-takeover guard):
  //   `allowDifferentEmails: false` (explicit; this is the default) is the
  //   primary hostile-takeover guard. It prevents an attacker from creating
  //   a social account with a different email and using it to take over an
  //   existing Gibson user. The email from the provider MUST match the email
  //   stored in the Gibson user row, and that row MUST have emailVerified=true
  //   (enforced by emailAndPassword.requireEmailVerification above).
  //
  //   Consequence: a social sign-in that matches an unverified-email Gibson
  //   user will be rejected — Better Auth refuses to link to an account that
  //   has not verified its email. This is correct: if the email is unverified,
  //   the Gibson user might not own the email address, and we cannot prove the
  //   social identity belongs to the same person.
  //
  //   `trustedProviders`: all four enabled social providers are listed. A trusted
  //   provider can auto-link to an existing user when the emails match and the
  //   target user is verified. Without this list, users would need to explicitly
  //   call linkSocial() while already signed in — the auto-link-on-first-signin
  //   UX would not work.
  //
  //   `disableImplicitLinking: false` (default): implicit auto-linking is on. If
  //   this spec ever needs to restrict to explicit-only linking, flip this to true.
  account: {
    accountLinking: {
      enabled: true,
      // allowDifferentEmails MUST remain false. See security comment above.
      allowDifferentEmails: false,
      // All four providers are trusted for auto-link on first social sign-in.
      // These names must match Better Auth's provider IDs exactly.
      trustedProviders: ["github", "gitlab", "google", "microsoft"],
    },
  },

  // Server-side enforcement of password policy on every path that writes a
  // password. Better Auth's emailAndPassword config only ships length checks,
  // so we apply:
  //   1. Complexity rules (same set the signup form's Zod schema enforces in
  //      app/(public)/signup/page.tsx).
  //   2. HIBP breach check (requirement 7 of auth-flow-hardening) via the
  //      k-anonymous Pwned Passwords range API. Runs AFTER complexity so we
  //      never make a network call for a password we'd reject anyway.
  //
  // Applies to:
  //   - /sign-up/email                     (new account)
  //   - /reset-password                    (Better Auth's password-reset flow)
  //   - /update-user                       (profile update, which may contain
  //                                         a new password; also the path
  //                                         we reuse for claim-account)
  //   - any other path that carries a `password` field in the body — defence
  //     in depth in case Better Auth adds a new password-write endpoint we
  //     haven't explicitly listed here.
  //
  // Fail-mode matrix for HIBP:
  //   - breached:true    → reject (APIError BAD_REQUEST / PASSWORD_BREACHED)
  //   - breached:false   → allow, increment `hibp_checks_total{outcome=clean}`
  //   - breached:unknown → fail OPEN (allow the change), emit `hibp_unavailable`
  //                        audit + increment `hibp_checks_total{outcome=unavailable}`.
  //                        Rationale: locking users out because an external API
  //                        is down is worse than briefly accepting a password
  //                        that MIGHT be breached — audit + metric let ops spot
  //                        the outage and investigate.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = ctx.body as { password?: unknown } | undefined;
      const rawPw = body?.password;
      // Skip paths that don't carry a password at all.
      if (typeof rawPw !== "string" || rawPw.length === 0) {
        // But we still want to enforce the policy on the well-known
        // password-write paths even if the payload is malformed, because
        // Better Auth will later validate and may surface a confusing error.
        // Keep the original behaviour: non-matching paths / no password body
        // → early return, let Better Auth handle it.
        const passwordWritePaths = new Set(["/sign-up/email", "/reset-password", "/update-user"]);
        if (!passwordWritePaths.has(ctx.path)) return;
        // Path expects a password but body doesn't have one — let Better Auth
        // produce its own validation error.
        return;
      }

      const pw = rawPw;
      const fails: string[] = [];
      if (pw.length < 12) fails.push("at least 12 characters");
      if (!/[A-Z]/.test(pw)) fails.push("an uppercase letter");
      if (!/[a-z]/.test(pw)) fails.push("a lowercase letter");
      if (!/[0-9]/.test(pw)) fails.push("a number");
      if (!/[^A-Za-z0-9]/.test(pw)) fails.push("a special character");
      if (fails.length > 0) {
        throw new APIError("BAD_REQUEST", {
          message: `Password must contain ${fails.join(", ")}.`,
        });
      }

      // HIBP check runs AFTER complexity — no need to hit the network for a
      // password we'd reject anyway.
      const result = await isPasswordBreached(pw);
      if (result.breached === true) {
        hibpChecks.inc({ outcome: "breached" });
        throw new APIError("BAD_REQUEST", {
          message:
            "This password has appeared in a public breach. Please choose a different one.",
          code: "PASSWORD_BREACHED",
        });
      }
      if (result.breached === "unknown") {
        hibpChecks.inc({ outcome: "unknown" });
        emitAuthAudit({
          action: "hibp_unavailable",
          outcome: "failed",
          userId: "anonymous",
          reason: result.reason,
        });
        // fail-open — password is allowed.
        return;
      }
      // breached === false
      hibpChecks.inc({ outcome: "clean" });
    }),
  },

  // Auto-create a personal organisation for every new user, regardless of the
  // sign-in path. This hook fires for social sign-ins (GitHub, GitLab, Google,
  // Microsoft) which never go through signUpAction. Email+password signups go
  // through signUpAction which still handles org creation directly (it owns
  // the retry loop, rollback, and Stripe flow).
  //
  // Guard: DASHBOARD_AUTO_CREATE_ORG must equal "true" (the default in
  // .env.example and values.yaml). Unset or any other value skips the hook so
  // operators can opt out in environments where org creation is managed
  // externally (e.g. tenant-operator driven flows).
  //
  // Safety: createPersonalOrg is idempotent — it no-ops if an org with the
  // derived slug already exists. Failures are caught here so a failed org
  // creation never blocks the sign-in response.
  databaseHooks: {
    user: {
      create: {
        after: async (user: User & Record<string, unknown>) => {
          if (process.env.DASHBOARD_AUTO_CREATE_ORG !== "true") return;
          try {
            const result = await createPersonalOrg(user.id, user.name ?? "");
            if (result.created) {
              console.log(
                `[auth-server] Auto-created personal org "${result.slug}" for user ${user.id}`
              );
            }
          } catch (err) {
            // Don't rethrow — org creation failure must not block sign-in.
            console.error(
              `[auth-server] Auto-create org failed for user ${user.id}:`,
              err
            );
          }
        },
      },
    },
  },

  plugins: [
    organization({
      teams: {
        enabled: true,
      },
    }),
    admin(),
    // nextCookies must be the last plugin so its hooks see set-cookie
    // commands from prior plugins and forward them through Next.js
    // cookies(). This is what lets Server Actions in app/actions/auth/*
    // commit Better Auth session cookies on the response without
    // bespoke header copying.
    nextCookies(),
  ],
};

export const auth = betterAuth(authOptions);

// Validate billing configuration at startup. This throws loudly when paid tiers
// are enabled but required Stripe env vars are missing, preventing silent
// misconfiguration from reaching a live checkout flow.
try {
  validateBillingConfig();
} catch (err) {
  // Re-throw so pod startup fails hard. A misconfigured billing setup is a
  // blocking error in paid-tier deployments — failing here is safer than
  // allowing checkout sessions with an invalid key.
  throw err;
}

// Run migrations on startup (idempotent — only creates missing tables/columns).
// Dynamic import: better-auth/db/migration is server-only and unavailable at build time.
//
// GUARD: skip during Next.js production build (NEXT_PHASE=phase-production-build).
// Next.js "collect page data" imports server modules to extract metadata, which
// would otherwise trigger a DB connection attempt against an unavailable Postgres
// in the build container and fail the build. Migrations still run on the first
// real request inside the running container.
if (process.env.NEXT_PHASE === "phase-production-build") {
  // no-op at build time; wiring preserved for runtime.
} else import("better-auth/db/migration")
  .then(({ getMigrations }) =>
    getMigrations(auth.options).then(({ runMigrations }) => runMigrations())
  )
  .then(() => {
    console.log("[auth-server] Database migrations complete");
  })
  .then(async () => {
    try {
      const result = await runGrandfatherEmailVerifiedMigration(pool);
      if (result.applied) {
        console.log(
          `[auth-server] Grandfather email-verified migration applied: ${result.updatedRows} users flipped (cutoff=${result.cutoff.toISOString()})`
        );
      } else {
        console.log(
          `[auth-server] Grandfather email-verified migration already applied at ${result.appliedAt.toISOString()} — skipping`
        );
      }
    } catch (err) {
      // Don't rethrow — a failed grandfather migration must not crash startup.
      console.error("[auth-server] Grandfather email-verified migration failed:", err);
    }
  })
  .then(async () => {
    try {
      const result = await runSocialProviderProfileMigration(pool);
      if (result.applied) {
        console.log(
          `[auth-server] Social provider profile migration applied at ${result.appliedAt.toISOString()}`
        );
      } else {
        console.log(
          `[auth-server] Social provider profile migration already applied at ${result.appliedAt.toISOString()} — skipping`
        );
      }
    } catch (err) {
      // Don't rethrow — a failed column-add must not crash startup.
      console.error("[auth-server] Social provider profile migration failed:", err);
    }
  })
  .catch((err) => {
    console.error("[auth-server] Migration failed:", err);
  });
