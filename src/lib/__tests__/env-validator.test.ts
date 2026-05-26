/**
 * Contract tests for the boot-time required-env validator.
 *
 * Spec: one-code-path (deploy#186), slice deploy#206.
 *
 * Strategy: for each required env var, prime the env with EVERY required key
 * set to a plausible value, then delete the single var under test and assert
 * `validateEnv()` throws an `EnvValidationError` whose `missing` list names
 * that key. This is the canonical "each required key missing one at a time"
 * acceptance criterion from the slice ticket.
 *
 * We also assert:
 *   - all-keys-present → does not throw
 *   - shape validation: a malformed URL is rejected even if non-empty
 *   - typed accessor `env.X` throws when the var is missing at access time
 *     (defence in depth — same shape slice #196's `requireEnv()` had)
 *   - production-only entries are skipped when NODE_ENV !== 'production'
 *
 * The test isolates `process.env` via beforeEach/afterEach so it never
 * pollutes adjacent tests. Each test uses a fresh shallow clone of the
 * pre-test env (vitest does not isolate process.env automatically).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EnvValidationError,
  REQUIRED_ENV,
  env,
  validateEnv,
} from '../env-validator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A plausible, type-correct value for every required env var.
 * Tests start from this fully-populated env, then mutate.
 */
const VALID_ENV: Record<string, string> = {
  // Identity
  ZITADEL_ISSUER: 'https://auth.zeroroot.local:30443',
  ZITADEL_CLIENT_ID: 'gibson-dashboard',
  ZITADEL_CLIENT_SECRET: 'shh-test',
  ZITADEL_AUDIENCE: 'gibson-platform',
  ALLOWED_SERVICE_SUBJECTS: '111,222,333',

  // Auth.js
  AUTH_SECRET: 'a'.repeat(32),
  AUTH_URL: 'https://app.zeroroot.local:30443',
  POST_LOGOUT_REDIRECT_URI: 'https://app.zeroroot.local:30443',

  // Daemon front door
  GIBSON_PLATFORM_PUBLIC_URL: 'https://api.zeroroot.local:30443',
  GIBSON_PUBLIC_URL: 'https://api.zeroroot.local:30443',
  GIBSON_API_URL: 'http://gibson-envoy:30443',
  PUBLIC_URL: 'https://app.zeroroot.local:30443',

  // Stores
  DATABASE_URL: 'postgres://user:pass@db:5432/gibson_dashboard',
  NEO4J_URI: 'bolt://neo4j:7687',
  NEO4J_PASSWORD: 'neo4j-pw',
  REDIS_URL: 'redis://redis:6379',

  // Feature switches
  DASHBOARD_CAPTCHA_PROVIDER: 'disabled',
  DASHBOARD_HIBP_ENABLED: 'true',
  DASHBOARD_EMAIL_PROVIDER: 'log',

  // Observability
  LOKI_URL: 'http://gibson-loki:3100',

  // Force production codepath so prodOnly entries are enforced — the test
  // suite must exercise every required key, including prodOnly ones.
  NODE_ENV: 'production',
};

let savedEnv: NodeJS.ProcessEnv;

// NodeJS.ProcessEnv types insist on NODE_ENV being present; we cast through
// `unknown` to allow shallow-clone fixtures without making every test repeat
// the noise of `as NodeJS.ProcessEnv`. The runtime semantics are identical.
function setProcessEnv(envObj: Record<string, string>): void {
  process.env = envObj as unknown as NodeJS.ProcessEnv;
}

beforeEach(() => {
  savedEnv = process.env;
  setProcessEnv({ ...VALID_ENV });
});

afterEach(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('env-validator: validateEnv()', () => {
  it('passes when every required env var is set to a valid value', () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws EnvValidationError when ANY single required var is missing', () => {
    for (const spec of REQUIRED_ENV) {
      // Reset to a fully-valid env, then remove the single var under test.
      setProcessEnv({ ...VALID_ENV });
      delete process.env[spec.name];

      let caught: unknown;
      try {
        validateEnv();
      } catch (err) {
        caught = err;
      }

      expect(
        caught,
        `validateEnv should throw when ${spec.name} is missing`,
      ).toBeInstanceOf(EnvValidationError);

      const e = caught as EnvValidationError;
      expect(
        e.missing.map((s) => s.name),
        `EnvValidationError.missing should include ${spec.name}`,
      ).toContain(spec.name);

      // The message must NAME the missing key — operators read this in pod logs.
      expect(e.message).toContain(spec.name);
    }
  });

  it('lists every missing key in a single throw (no early-exit)', () => {
    setProcessEnv({ ...VALID_ENV });
    delete process.env.ZITADEL_ISSUER;
    delete process.env.AUTH_SECRET;
    delete process.env.GIBSON_API_URL;

    let caught: unknown;
    try {
      validateEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    const missingNames = e.missing.map((s) => s.name).sort();
    expect(missingNames).toEqual(
      ['AUTH_SECRET', 'GIBSON_API_URL', 'ZITADEL_ISSUER'].sort(),
    );
  });

  it('rejects malformed URLs even when the env var is set', () => {
    setProcessEnv({ ...VALID_ENV, ZITADEL_ISSUER: 'not-a-url' });
    let caught: unknown;
    try {
      validateEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    expect(e.malformed.map((m) => m.spec.name)).toContain('ZITADEL_ISSUER');
  });

  it('rejects non-boolean values for boolean-kind vars', () => {
    setProcessEnv({ ...VALID_ENV, DASHBOARD_HIBP_ENABLED: 'maybe' });
    let caught: unknown;
    try {
      validateEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    expect(e.malformed.map((m) => m.spec.name)).toContain(
      'DASHBOARD_HIBP_ENABLED',
    );
  });

  it('rejects empty-string values as missing for string-kind vars', () => {
    setProcessEnv({ ...VALID_ENV, ZITADEL_CLIENT_ID: '' });
    let caught: unknown;
    try {
      validateEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    expect(e.malformed.map((m) => m.spec.name)).toContain('ZITADEL_CLIENT_ID');
  });

  it('skips prodOnly entries when NODE_ENV is not production', () => {
    setProcessEnv({ ...VALID_ENV, NODE_ENV: 'development' });
    delete process.env.ALLOWED_SERVICE_SUBJECTS;
    // prodOnly entry — should NOT cause a throw when NODE_ENV=development
    expect(() => validateEnv()).not.toThrow();
  });

  it('enforces prodOnly entries when NODE_ENV is production', () => {
    setProcessEnv({ ...VALID_ENV, NODE_ENV: 'production' });
    delete process.env.ALLOWED_SERVICE_SUBJECTS;
    let caught: unknown;
    try {
      validateEnv();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    expect(e.missing.map((s) => s.name)).toContain('ALLOWED_SERVICE_SUBJECTS');
  });
});

describe('env-validator: typed accessor (env.X)', () => {
  it('returns the value when the required var is set', () => {
    expect(env.ZITADEL_ISSUER).toBe('https://auth.zeroroot.local:30443');
    expect(env.AUTH_SECRET).toBe('a'.repeat(32));
  });

  it('throws EnvValidationError when a required var is read while missing', () => {
    delete process.env.ZITADEL_ISSUER;
    expect(() => env.ZITADEL_ISSUER).toThrow(EnvValidationError);
  });

  it('returns undefined for an unset optional var', () => {
    delete process.env.LANGFUSE_HOST;
    expect(env.LANGFUSE_HOST).toBeUndefined();
  });

  it('returns the value for a set optional var', () => {
    process.env.LANGFUSE_HOST = 'https://langfuse.example';
    expect(env.LANGFUSE_HOST).toBe('https://langfuse.example');
  });

  it('throws on an undeclared key', () => {
    expect(() => {
      // Access through an untyped cast so we exercise the Proxy's
      // "unknown key" branch — the EnvShape type would otherwise let any
      // string-keyed access through with `string | undefined`.
      (env as Record<string, unknown>).NOT_DECLARED_ANYWHERE;
    }).toThrow(/not declared/);
  });
});
