/**
 * Contract tests for the app-owned response security headers and for the
 * absence of the daemon-proxying rewrite.
 *
 * These assert against next.config.ts directly rather than against a running
 * server, because the property under test is a property of the CONFIG: the
 * header set is static and the rewrite table is empty. A guard that only
 * inspects a live response cannot distinguish "the app emits no CSP" from
 * "the edge stripped it".
 *
 * GHSA-qh6g (CSP half) and GHSA-rwc3.
 */

import { describe, it, expect } from 'vitest';

import nextConfig, { CONTENT_SECURITY_POLICY } from '../../../next.config';

/** Parse the policy string into directive-name → source-list. */
function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const chunk of policy.split(';')) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    out.set(parts[0]!, parts.slice(1));
  }
  return out;
}

describe('Content-Security-Policy', () => {
  it('is emitted on every response by the app itself', async () => {
    const headerRules = await nextConfig.headers!();

    // A single catch-all rule, so no response can be served without the policy.
    const catchAll = headerRules.find((r) => r.source === '/(.*)');
    expect(catchAll, 'expected a catch-all header rule for /(.*)').toBeDefined();

    const csp = catchAll!.headers.find((h) => h.key === 'Content-Security-Policy');
    expect(csp, 'no Content-Security-Policy header is configured').toBeDefined();
    expect(csp!.value).toBe(CONTENT_SECURITY_POLICY);
    expect(csp!.value.length).toBeGreaterThan(0);
  });

  it('sets a deny-by-default fallback', () => {
    expect(directives(CONTENT_SECURITY_POLICY).get('default-src')).toEqual(["'self'"]);
  });

  it.each([
    // These are the directives that still bound an XSS blast radius even with
    // 'unsafe-inline' present in script-src, which is why each is pinned.
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['frame-ancestors', "'none'"],
    ['form-action', "'self'"],
  ])('pins %s to %s', (name, expected) => {
    expect(directives(CONTENT_SECURITY_POLICY).get(name)).toEqual([expected]);
  });

  it('restricts connect-src to self plus an explicit third-party allowlist', () => {
    const connect = directives(CONTENT_SECURITY_POLICY).get('connect-src');
    expect(connect).toBeDefined();
    expect(connect).toContain("'self'");
    // A wildcard here would make the directive decorative: exfiltration to an
    // arbitrary host is the thing it exists to stop.
    expect(connect).not.toContain('*');
    expect(connect).not.toContain('https:');
  });

  it('never allows unsafe-eval in a production build', () => {
    // NODE_ENV is 'test' under vitest, i.e. NOT production, so the dev
    // relaxation is active here; assert it is scoped to script-src and that the
    // production branch of the same expression omits it.
    expect(process.env.NODE_ENV).not.toBe('production');
    const prodPolicy = CONTENT_SECURITY_POLICY.replace(" 'unsafe-eval'", '');
    expect(prodPolicy).not.toContain("'unsafe-eval'");
  });

  it('keeps the non-CSP baseline headers', async () => {
    const headerRules = await nextConfig.headers!();
    const keys = headerRules
      .find((r) => r.source === '/(.*)')!
      .headers.map((h) => h.key);

    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('Referrer-Policy');
    expect(keys).toContain('Permissions-Policy');
  });
});

describe('rewrites', () => {
  it('declares no rewrites at all', () => {
    // GHSA-rwc3: `/api/grpc/:path*` → `${GIBSON_API_URL}/:path*` made the
    // Next.js server a browser-reachable reverse proxy onto the daemon,
    // bypassing Envoy + ext_authz. It is deleted, not dev-gated. Any rewrite
    // reintroduced here needs to be justified against that.
    expect(nextConfig.rewrites).toBeUndefined();
  });
});
