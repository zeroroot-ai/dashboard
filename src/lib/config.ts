/**
 * Environment Configuration
 *
 * Centralized environment variable handling with type safety and validation.
 * All environment variables should be accessed through this module.
 *
 * Required variables must be set in every environment (development and
 * production). Missing required variables cause the process to exit with a
 * clear error at startup. See .env.example for local-dev values.
 */

/**
 * Server-side environment configuration.
 * These variables are only available on the server side.
 */
export const serverConfig = {
  // Gibson Daemon Configuration.
  //
  // Spec headline-feature-completion R11, `gibsonDaemonUrl` was removed.
  // It existed only as a fallback for direct daemon-channel
  // `createGrpcTransport({ baseUrl })` callsites, which the
  // dashboard-admin-via-envoy / zero-trust-hardening / security-hardening
  // doctrine forbids. All daemon RPCs now go through the Envoy edge via
  // `userClient` / `serviceClient` in `src/lib/gibson-client.ts`, which
  // dial `ADMIN_ENVOY_BASE_URL` (default `https://api.zeroroot.local:30443`).
  // The two API routes that still composed a direct transport were
  // migrated to `userClient` in the same change.
  //
  // `gibsonPlatformPublicUrl` is retained for callsites that render
  // user-facing links to the public platform host (settings page,
  // documentation cross-links). It does NOT carry a daemon URL, the
  // historical fallback to `GIBSON_DAEMON_URL` here is also dropped so
  // an ops engineer cannot accidentally surface a daemon endpoint to
  // browsers via this field.
  //
  // REQUIRED: set GIBSON_PLATFORM_PUBLIC_URL to the Envoy ingress URL
  // (e.g. https://api.zeroroot.local:30443). See .env.example.
  gibsonPlatformPublicUrl: process.env.GIBSON_PLATFORM_PUBLIC_URL,

  // Neo4j Database Configuration
  // REQUIRED: set NEO4J_URI to the Neo4j bolt endpoint (e.g. bolt://neo4j-service:7687).
  neo4jUri: process.env.NEO4J_URI,
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || '',

  // Auth.js + Zitadel, public dashboard URL Auth.js uses for OIDC
  // redirect URIs and the email-nonce HMAC secret used by the
  // legacy missing-email recovery flow. The HMAC secret is just a
  // generic signing key; the env var name is retained at AUTH_SECRET
  // (the Auth.js convention) under unified-identity-and-authorization
  // Phase 4. NEXTAUTH_URL is the canonical dashboard URL.
  // Spec Phase 4 Requirement 9.1: Auth.js is the canonical session layer.
  //
  // REQUIRED: set AUTH_URL (or NEXTAUTH_URL) to the dashboard public URL.
  dashboardPublicUrl: process.env.NEXTAUTH_URL || process.env.AUTH_URL,
  authHmacSecret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || '',

  // Dashboard PostgreSQL (Auth.js + tenant state)
  databaseUrl: process.env.DATABASE_URL || '',

  // Langfuse Configuration (for trace viewer).
  // Optional, when LANGFUSE_HOST is unset, langfuseHost is null and
  // consumers must handle absence rather than receive a localhost-pointing URL.
  langfuseHost: process.env.LANGFUSE_HOST ?? null,
  langfuseAdminPublicKey: process.env.LANGFUSE_ADMIN_PUBLIC_KEY || '',
  langfuseAdminSecretKey: process.env.LANGFUSE_ADMIN_SECRET_KEY || '',

  // Node Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Client-side environment configuration.
 * These variables are exposed to the browser via NEXT_PUBLIC_ prefix.
 */
const clientConfig = {
  // Public API endpoints (if needed)
  // Add NEXT_PUBLIC_ prefixed variables here when needed
} as const;

/**
 * Validate required environment variables.
 * Call this function during application startup to fail fast if configuration is invalid.
 *
 * Required variables are checked unconditionally (not only in production):
 *   - GIBSON_PLATFORM_PUBLIC_URL
 *   - NEO4J_URI
 *   - AUTH_URL / NEXTAUTH_URL
 *
 * Auth.js secrets and DATABASE_URL are additionally checked in production.
 *
 * @throws Error if required environment variables are missing
 */
export function validateEnvConfig(): void {
  const errors: string[] = [];

  // Required in every environment, these variables have no safe fallback.

  if (!serverConfig.gibsonPlatformPublicUrl) {
    errors.push(
      'GIBSON_PLATFORM_PUBLIC_URL is required (used for platform links; set to your ' +
      'Envoy ingress URL, e.g. https://api.zeroroot.local:30443). See .env.example.',
    );
  }

  if (!serverConfig.neo4jUri) {
    errors.push(
      'NEO4J_URI is required (e.g. bolt://neo4j-service:7687). See .env.example.',
    );
  }

  if (!serverConfig.dashboardPublicUrl) {
    errors.push(
      'AUTH_URL (or NEXTAUTH_URL) is required (the dashboard public URL for ' +
      'Auth.js OIDC callbacks, e.g. http://localhost:30081). See .env.example.',
    );
  }

  // Validate Auth.js configuration in production
  if (serverConfig.isProduction) {
    if (!serverConfig.authHmacSecret) {
      errors.push('AUTH_SECRET (or legacy NEXTAUTH_SECRET) is required in production');
    }
    if (!serverConfig.databaseUrl) {
      errors.push('DATABASE_URL is required in production');
    }
  }

  // Warn about missing Neo4j password (not fatal, but recommended)
  if (!serverConfig.neo4jPassword) {
    console.warn('NEO4J_PASSWORD not set - Neo4j client may fail to connect');
  }

  // Throw if any errors found
  if (errors.length > 0) {
    throw new Error(
      `Environment configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    );
  }
}

/**
 * Get a server-side environment variable.
 * This is a helper for accessing environment variables with optional default values.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value or default
 */
function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}
