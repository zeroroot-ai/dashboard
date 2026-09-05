/**
 * Unit tests for `resolveServiceIdentity` in
 * `src/lib/auth/identity-resolver.ts`.
 *
 * Spec: canonical-service-identity Req 12.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveServiceIdentity,
  __resetIdentityResolverForTests,
} from '../identity-resolver';

let tmpDir: string;
let mapPath: string;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sa-id-map-'));
  mapPath = join(tmpDir, 'sa-identity-map.json');
  process.env.SA_IDENTITY_MAP_PATH = mapPath;
  __resetIdentityResolverForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetIdentityResolverForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveServiceIdentity', () => {
  it('returns the readable name for a known numeric sub', () => {
    writeFileSync(
      mapPath,
      JSON.stringify({
        'gibson-tenant-operator': '370767967299829765',
        'gibson-dashboard-sa': '370767968507789317',
      }),
    );
    expect(resolveServiceIdentity('370767967299829765')).toBe(
      'gibson-tenant-operator',
    );
    expect(resolveServiceIdentity('370767968507789317')).toBe(
      'gibson-dashboard-sa',
    );
  });

  it('returns null for an unknown numeric sub (e.g. a human user)', () => {
    writeFileSync(
      mapPath,
      JSON.stringify({ 'gibson-tenant-operator': '370767967299829765' }),
    );
    expect(resolveServiceIdentity('999999')).toBeNull();
  });

  it('returns null for an empty input', () => {
    writeFileSync(mapPath, JSON.stringify({}));
    expect(resolveServiceIdentity('')).toBeNull();
  });

  it('returns null when the map file is missing entirely (last-known-good empty)', () => {
    expect(resolveServiceIdentity('370767967299829765')).toBeNull();
  });

  it('refreshes the cache when the file mtime changes', () => {
    writeFileSync(mapPath, JSON.stringify({ 'sa-one': '111' }));
    expect(resolveServiceIdentity('111')).toBe('sa-one');

    // Rewrite the file with a different value AND bump mtime explicitly
    // (writeFileSync alone might land in the same ms tick on fast tmpfs).
    writeFileSync(mapPath, JSON.stringify({ 'sa-two': '222' }));
    const future = new Date(Date.now() + 5_000);
    utimesSync(mapPath, future, future);

    expect(resolveServiceIdentity('222')).toBe('sa-two');
  });
});

describe('isolation guard (manual review pin)', () => {
  // The TS compiler enforces 'server-only' import; this test documents
  // the intent that the resolver must NOT be used inside auth-decision
  // code paths. The vitest visibility guard at
  // identity-resolver.visibility.test.ts walks the source tree and pins
  // importer paths to log/audit code only.
  it('exports only the read-only Resolve operation + a test reset', async () => {
    const mod = await import('../identity-resolver');
    const exports = Object.keys(mod);
    expect(exports.sort()).toEqual(
      ['__resetIdentityResolverForTests', 'resolveServiceIdentity'].sort(),
    );
  });
});
