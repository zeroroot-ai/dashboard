/**
 * Environment Configuration
 *
 * Centralized environment variable handling with type safety and validation.
 * All environment variables should be accessed through this module.
 */

/**
 * Server-side environment configuration.
 * These variables are only available on the server side.
 */
export const serverConfig = {
  // Gibson Daemon Configuration
  gibsonDaemonUrl: process.env.GIBSON_DAEMON_URL || process.env.GIBSON_API_URL || process.env.GIBSON_ADDR || 'http://localhost:50002',
  gibsonPlatformPublicUrl: process.env.GIBSON_PLATFORM_PUBLIC_URL || process.env.GIBSON_DAEMON_URL || process.env.GIBSON_API_URL || 'http://localhost:50002',

  // Neo4j Database Configuration
  neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || '',

  // Better Auth Configuration
  betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || '',

  // Dashboard PostgreSQL (Better Auth database)
  databaseUrl: process.env.DATABASE_URL || '',

  // Langfuse Configuration (for trace viewer)
  langfuseHost: process.env.LANGFUSE_HOST || 'http://localhost:3000',
  langfuseAdminPublicKey: process.env.LANGFUSE_ADMIN_PUBLIC_KEY || '',
  langfuseAdminSecretKey: process.env.LANGFUSE_ADMIN_SECRET_KEY || '',

  // Node Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

/**
 * Client-side environment configuration.
 * These variables are exposed to the browser via NEXT_PUBLIC_ prefix.
 */
export const clientConfig = {
  // Public API endpoints (if needed)
  // Add NEXT_PUBLIC_ prefixed variables here when needed
} as const;

/**
 * Validate required environment variables.
 * Call this function during application startup to fail fast if configuration is invalid.
 *
 * @throws Error if required environment variables are missing
 */
export function validateEnvConfig(): void {
  const errors: string[] = [];

  // Validate Better Auth configuration in production
  if (serverConfig.isProduction) {
    if (!serverConfig.betterAuthSecret) {
      errors.push('BETTER_AUTH_SECRET is required in production');
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
      `Environment configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
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
export function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}
