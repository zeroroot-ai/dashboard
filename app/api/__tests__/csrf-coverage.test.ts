/**
 * CSRF coverage across `app/api/**`.
 *
 * `src/lib/auth/csrf.ts` requires every mutating handler under `app/api/**` to
 * call `requireCsrf`. The rule was written down and then not kept: 7 of 25
 * route files with a mutating export called it, and nothing looked for the
 * other 18.
 *
 * Two things are pinned here, and neither can be satisfied by mocking:
 *
 *  1. INVENTORY. Every mutating export is gated or carries a stated exemption,
 *     checked against the real source tree. Per-export, so a gated POST beside
 *     an ungated DELETE is a failure.
 *  2. EXEMPTIONS DO NOT DRIFT. The exempt set is asserted to be exactly the
 *     handlers audited below. Adding an exemption is a deliberate act that has
 *     to come with a test change and a reason someone read.
 *
 * The route-level suites stub `requireCsrf` so their own cases stay about their
 * own subject. This file does not, which is the point: it is the one place the
 * gate cannot be mocked away.
 *
 * Enforcement at build time is `scripts/check-api-route-csrf.mjs`, which is in
 * the security-lint preset and self-tests via `check-guard-selftests.mjs`.
 *
 * Refs GHSA-qh6g residual.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const API_DIR = join(REPO_ROOT, 'app', 'api');

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

/**
 * The complete, audited set of mutating handlers that do NOT call requireCsrf.
 * Each is exempt for a reason that is stated in the route file itself; the
 * summary here exists so a reviewer of THIS file can see the whole set at once.
 *
 * Adding an entry means a mutating endpoint is reachable cross-site. Do it only
 * when a token genuinely cannot be carried, and say why in both places.
 */
const AUDITED_EXEMPT: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts:POST':
    'Auth.js validates its own CSRF token on its own action routes',
  'app/api/auth/federated-signout/route.ts:POST':
    'top-level navigation / form post cannot set a header; uses Sec-Fetch-* instead',
  'app/api/test/inject-fault/route.ts:POST': '404 unless TEST_FIXTURES_ENABLED; e2e-only',
  'app/api/test/fga-revoke/route.ts:POST': '404 unless TEST_FIXTURES_ENABLED; e2e-only',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Mutating handlers exported by a route file, however they are spelled. */
function mutatingExports(text: string): string[] {
  return MUTATING.filter(
    (m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(text) ||
      new RegExp(`export\\s+const\\s+${m}\\s*[:=]`).test(text) ||
      new RegExp(`export\\s*\\{[^}]*\\b${m}\\b`).test(text),
  );
}

interface Handler {
  key: string;
  gated: boolean;
  exemptReason: string | null;
}

function inventory(): Handler[] {
  const out: Handler[] = [];
  for (const file of walk(API_DIR)) {
    const rel = relative(REPO_ROOT, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    const gated = /\brequireCsrf\s*\(/.test(text);
    const exempt = /@csrf-exempt:\s*(\S[^\n*]*)/.exec(text);
    for (const method of mutatingExports(text)) {
      out.push({
        key: `${rel}:${method}`,
        gated,
        exemptReason: exempt ? exempt[1].trim() : null,
      });
    }
  }
  return out;
}

describe('CSRF coverage across app/api/**', () => {
  const handlers = inventory();

  it('finds mutating route handlers at all (guards against a vacuous pass)', () => {
    // If the walk or the export detection breaks, every assertion below would
    // pass on an empty list. Pin a floor so silence cannot masquerade as green.
    expect(handlers.length).toBeGreaterThan(20);
  });

  it('every mutating handler is gated or exempt', () => {
    const unprotected = handlers
      .filter((h) => !h.gated && !h.exemptReason)
      .map((h) => h.key);
    expect(unprotected).toEqual([]);
  });

  it('the exempt set is exactly the audited one', () => {
    const exempt = handlers
      .filter((h) => !h.gated && h.exemptReason)
      .map((h) => h.key)
      .sort();
    expect(exempt).toEqual(Object.keys(AUDITED_EXEMPT).sort());
  });

  it('every exemption states a reason', () => {
    const reasonless = handlers
      .filter((h) => !h.gated && h.exemptReason !== null && h.exemptReason.length < 20)
      .map((h) => h.key);
    expect(reasonless).toEqual([]);
  });

  it.each(
    inventory()
      .filter((h) => h.gated)
      .map((h) => h.key),
  )('%s is gated', (key) => {
    const h = handlers.find((x) => x.key === key)!;
    expect(h.gated).toBe(true);
  });
});

describe('the gate actually refuses a tokenless request', () => {
  // One route, end to end, with the REAL requireCsrf: enough to prove the
  // wiring (import, call site, error shape) rather than only its presence.
  it('POST /api/world/review returns 403 with no token', async () => {
    const { POST } = await import('../world/review/route');
    const req = new NextRequest('http://localhost/api/world/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: 't', verdict: 'dismiss' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'csrf-token-required' });
  });

  it('POST /api/world/review returns 403 when the token does not match the cookie', async () => {
    const { POST } = await import('../world/review/route');
    const req = new NextRequest('http://localhost/api/world/review', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'csrf-token=aaaaaaaaaaaaaaaa',
        'x-csrf-token': 'bbbbbbbbbbbbbbbb',
      },
      body: JSON.stringify({ targetId: 't', verdict: 'dismiss' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: 'csrf-token-mismatch' });
  });
});
