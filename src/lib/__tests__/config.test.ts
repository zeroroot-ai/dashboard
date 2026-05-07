/**
 * config.test.ts
 *
 * Tests for validateEnvConfig() behavior after the localhost-default removal
 * (spec: naming-and-config-standardization Requirement 2.5).
 *
 * Each required env var, when unset, should cause validateEnvConfig() to throw
 * an Error whose message names the missing variable. All required vars set
 * together should not throw.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// We need to re-import config after manipulating process.env.
// vitest supports dynamic imports with vi.resetModules() for this.
import { vi } from 'vitest';

const REQUIRED_VARS = [
  'GIBSON_PLATFORM_PUBLIC_URL',
  'NEO4J_URI',
] as const;

// AUTH_URL or NEXTAUTH_URL — either satisfies the requirement.
const AUTH_URL_VARS = ['AUTH_URL', 'NEXTAUTH_URL'] as const;

// Safe baseline values that satisfy all required vars.
const BASELINE_ENV: Record<string, string> = {
  GIBSON_PLATFORM_PUBLIC_URL: 'https://api.zero-day.local:30443',
  NEO4J_URI: 'bolt://neo4j-service:7687',
  AUTH_URL: 'http://localhost:3000',
};

describe('validateEnvConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear vars that might be set in the host environment
    for (const key of [...REQUIRED_VARS, ...AUTH_URL_VARS]) {
      delete process.env[key];
    }
    // Apply the baseline
    Object.assign(process.env, BASELINE_ENV);
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(BASELINE_ENV)) {
      delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    vi.resetModules();
  });

  it('does not throw when all required vars are set', async () => {
    const { validateEnvConfig } = await import('../config');
    expect(() => validateEnvConfig()).not.toThrow();
  });

  it('throws when GIBSON_PLATFORM_PUBLIC_URL is unset', async () => {
    delete process.env['GIBSON_PLATFORM_PUBLIC_URL'];
    const { validateEnvConfig } = await import('../config');
    expect(() => validateEnvConfig()).toThrowError('GIBSON_PLATFORM_PUBLIC_URL');
  });

  it('throws when NEO4J_URI is unset', async () => {
    delete process.env['NEO4J_URI'];
    const { validateEnvConfig } = await import('../config');
    expect(() => validateEnvConfig()).toThrowError('NEO4J_URI');
  });

  it('throws when both AUTH_URL and NEXTAUTH_URL are unset', async () => {
    delete process.env['AUTH_URL'];
    delete process.env['NEXTAUTH_URL'];
    const { validateEnvConfig } = await import('../config');
    expect(() => validateEnvConfig()).toThrowError('AUTH_URL');
  });

  it('does not throw when only NEXTAUTH_URL is set (AUTH_URL unset)', async () => {
    delete process.env['AUTH_URL'];
    process.env['NEXTAUTH_URL'] = 'http://localhost:3000';
    const { validateEnvConfig } = await import('../config');
    expect(() => validateEnvConfig()).not.toThrow();
  });

  it('returns null for langfuseHost when LANGFUSE_HOST is unset', async () => {
    delete process.env['LANGFUSE_HOST'];
    const { serverConfig } = await import('../config');
    expect(serverConfig.langfuseHost).toBeNull();
  });

  it('returns the LANGFUSE_HOST value when set', async () => {
    process.env['LANGFUSE_HOST'] = 'http://langfuse.example.com:3000';
    const { serverConfig } = await import('../config');
    expect(serverConfig.langfuseHost).toBe('http://langfuse.example.com:3000');
  });
});
