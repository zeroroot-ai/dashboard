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

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { Pool } from "pg";

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

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300, // 5 minutes — short enough to stay fresh, long enough to avoid DB on every request
    },
  },

  // Server-side enforcement of the same complexity rules the signup form's
  // Zod schema enforces on the client (app/(public)/signup/page.tsx). Better
  // Auth's emailAndPassword config only ships length checks, so the rest go
  // through a `before` hook on the sign-up endpoint.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const pw = String((ctx.body as { password?: unknown } | undefined)?.password ?? "");
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
    }),
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

// Run migrations on startup (idempotent — only creates missing tables/columns).
// Dynamic import: better-auth/db/migration is server-only and unavailable at build time.
import("better-auth/db/migration").then(({ getMigrations }) =>
  getMigrations(auth.options).then(({ runMigrations }) => runMigrations())
).then(() => {
  console.log("[auth-server] Database migrations complete");
}).catch((err) => {
  console.error("[auth-server] Migration failed:", err);
});
