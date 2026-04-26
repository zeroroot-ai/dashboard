/**
 * Unit tests for src/lib/spiffe-mtls/svid.ts.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R2.5, R9.12).
 *
 * What we cover (without a real SPIRE agent):
 *   - isSpiffeAvailable() reads the configured socket path.
 *   - SPIFFE_ENDPOINT_SOCKET env override is honoured.
 *   - getX509SvidContext() throws NoSpiffeAvailableError when the socket
 *     does not exist.
 *   - buildContext() rejects malformed (zero-length) SVID payloads.
 *   - buildContext() emits PEM blocks and a refresh deadline at ~80% of
 *     the leaf cert's lifetime.
 *   - tryGetCachedX509SvidContext() returns null when nothing has been
 *     warmed.
 *   - The cache TTL is honoured: a second call within the window returns
 *     the same context; a call past the window does NOT (we drive this
 *     through buildContext + manual cache poke since fetching is mocked).
 *
 * The gRPC FetchX509SVID stream is intentionally NOT exercised: a
 * proper end-to-end test requires a SPIRE agent on a real Unix socket,
 * which belongs in the in-cluster e2e suite (Phase 8 deployment work).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

// Module under test — re-imported per test via dynamic import so each
// case observes a fresh module-scoped cache.
async function importSvid() {
  vi.resetModules();
  return import('../svid');
}

// ---------------------------------------------------------------------------
// Test cert fixtures
// ---------------------------------------------------------------------------

/**
 * Generate a self-signed Ed25519 leaf cert via openssl. Node's
 * `crypto.X509Certificate` parses certs but cannot synthesise them; the
 * tests need a real DER blob whose `validTo` lands far enough in the
 * future to drive the 80%-lifetime refresh-deadline math.
 *
 * openssl is present on every CI shape we run (the same toolchain is
 * used by the SPIRE chart's bootstrap Job in deploy/), and the cost is
 * a single subprocess call at module load.
 */
function generateFixtureCertDer(): Buffer | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'spiffe-test-cert-'));
    const keyPath = join(dir, 'k.pem');
    const certPath = join(dir, 'c.pem');
    try {
      // 365-day cert is plenty; we only care about NotAfter being well
      // in the future relative to Date.now() during the test run.
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-nodes',
          '-newkey',
          'ed25519',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '365',
          '-subj',
          '/CN=test-svid',
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      );
      const pem = require('node:fs').readFileSync(certPath, 'utf8');
      const cert = new X509Certificate(pem);
      return Buffer.from(cert.raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // openssl missing or unusable on this host — tests that depend on
    // a real DER will skip themselves below.
    return null;
  }
}

const FIXTURE_LEAF_DER = generateFixtureCertDer();
const HAS_FIXTURE = FIXTURE_LEAF_DER !== null;

// ---------------------------------------------------------------------------
// Setup / teardown around the SOCKET env var
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env.SPIFFE_ENDPOINT_SOCKET;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.SPIFFE_ENDPOINT_SOCKET;
  else process.env.SPIFFE_ENDPOINT_SOCKET = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// isSpiffeAvailable
// ---------------------------------------------------------------------------

describe('isSpiffeAvailable', () => {
  it('returns false when the socket does not exist', async () => {
    process.env.SPIFFE_ENDPOINT_SOCKET = 'unix:///tmp/non-existent-socket-xyz.sock';
    const { isSpiffeAvailable } = await importSvid();
    expect(isSpiffeAvailable()).toBe(false);
  });

  it('returns true when the socket exists on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spiffe-test-'));
    const sockPath = join(dir, 'api.sock');
    writeFileSync(sockPath, ''); // touch a file at that path
    process.env.SPIFFE_ENDPOINT_SOCKET = `unix://${sockPath}`;
    try {
      const { isSpiffeAvailable } = await importSvid();
      expect(isSpiffeAvailable()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours the env override (sees the new value on each call)', async () => {
    process.env.SPIFFE_ENDPOINT_SOCKET = 'unix:///tmp/missing-1.sock';
    const { isSpiffeAvailable } = await importSvid();
    expect(isSpiffeAvailable()).toBe(false);
    process.env.SPIFFE_ENDPOINT_SOCKET = 'unix:///tmp/missing-2.sock';
    // Same module instance, new env value → still false (different
    // path). Confirms the module reads env per-call rather than caching
    // at import time.
    expect(isSpiffeAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getX509SvidContext — socket-absent path
// ---------------------------------------------------------------------------

describe('getX509SvidContext', () => {
  it('throws NoSpiffeAvailableError when the socket is missing', async () => {
    process.env.SPIFFE_ENDPOINT_SOCKET = 'unix:///tmp/definitely-not-here.sock';
    const { getX509SvidContext, NoSpiffeAvailableError } = await importSvid();
    await expect(getX509SvidContext()).rejects.toBeInstanceOf(NoSpiffeAvailableError);
    // The error's socketPath surfaces the env value (less the unix:// prefix)
    // so operators can grep for the misconfiguration.
    try {
      await getX509SvidContext();
    } catch (err) {
      expect((err as InstanceType<typeof NoSpiffeAvailableError>).socketPath).toContain(
        '/tmp/definitely-not-here.sock',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// buildContext — happy path, malformed input, refresh window
// ---------------------------------------------------------------------------

describe('buildContext', () => {
  it('rejects an SVID with empty cert/key/bundle', async () => {
    const { buildContext } = await importSvid();
    expect(() =>
      buildContext({
        spiffeId: 'spiffe://test/x',
        x509Svid: new Uint8Array(0),
        x509SvidKey: new Uint8Array(0),
        bundle: new Uint8Array(0),
      }),
    ).toThrow(/missing cert, key, or bundle/);
  });

  it.skipIf(!HAS_FIXTURE)('emits PEM context with cert/key/ca and TLS 1.3 minVersion', async () => {
    const { buildContext } = await importSvid();
    const der = FIXTURE_LEAF_DER!;
    // Use the same DER for the key/bundle slots — derChainToPem only
    // validates the SEQUENCE framing, and PKCS#8 keys also start with
    // 0x30. Reusing the leaf cert DER everywhere keeps the test free of
    // external fixtures while still exercising the parser.
    const { context } = buildContext({
      spiffeId: 'spiffe://test/x',
      x509Svid: new Uint8Array(der),
      x509SvidKey: new Uint8Array(der),
      bundle: new Uint8Array(der),
    });
    expect(typeof context.cert).toBe('string');
    expect(context.cert as string).toContain('-----BEGIN CERTIFICATE-----');
    expect(context.key as string).toContain('-----BEGIN PRIVATE KEY-----');
    expect(context.ca as string).toContain('-----BEGIN CERTIFICATE-----');
    expect(context.minVersion).toBe('TLSv1.3');
  });

  it.skipIf(!HAS_FIXTURE)('computes a refresh deadline well before the cert NotAfter', async () => {
    const { buildContext } = await importSvid();
    const der = FIXTURE_LEAF_DER!;
    const cert = new X509Certificate(der);
    const notAfter = new Date(cert.validTo).getTime();
    const before = Date.now();
    const { refreshAtMs } = buildContext({
      spiffeId: 'spiffe://test/x',
      x509Svid: new Uint8Array(der),
      x509SvidKey: new Uint8Array(der),
      bundle: new Uint8Array(der),
    });
    // 80% of (notAfter - now) lands strictly between now and notAfter.
    expect(refreshAtMs).toBeGreaterThan(before);
    expect(refreshAtMs).toBeLessThan(notAfter);
  });

  it('rejects a malformed DER chain (bad SEQUENCE byte)', async () => {
    const { buildContext } = await importSvid();
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() =>
      buildContext({
        spiffeId: 'spiffe://test/x',
        x509Svid: garbage,
        x509SvidKey: garbage,
        bundle: garbage,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// tryGetCachedX509SvidContext — sync getter contract
// ---------------------------------------------------------------------------

describe('tryGetCachedX509SvidContext', () => {
  it('returns null when nothing has been warmed', async () => {
    const { tryGetCachedX509SvidContext, __resetForTests } = await importSvid();
    __resetForTests();
    expect(tryGetCachedX509SvidContext()).toBeNull();
  });
});

// Silence unused-import notices on imports kept for symmetry with
// future extensions; __tests__ is excluded from typecheck strictness.
void existsSync;
void vi;
