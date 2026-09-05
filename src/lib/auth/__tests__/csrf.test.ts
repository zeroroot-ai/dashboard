/**
 * Unit tests for `requireCsrf` and `csrfErrorResponse` in
 * `src/lib/auth/csrf.ts`.
 *
 * Strategy: build NextRequest fixtures with controlled cookie + header
 * combinations and assert the helper allows / throws the right
 * `CsrfErrorReason`.
 *
 * Spec: zero-trust-hardening Req 11.5.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

import {
  requireCsrf,
  csrfErrorResponse,
  CsrfError,
  CSRF_HEADER_NAME,
  CSRF_FORM_FIELD,
} from '../csrf';
import { CSRF_COOKIE_NAME } from '@/src/lib/csrf';

const TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);

function makeRequest(opts: {
  cookieToken?: string;
  headerToken?: string;
  body?: string;
  contentType?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.cookieToken) {
    headers.set('cookie', `${CSRF_COOKIE_NAME}=${opts.cookieToken}`);
  }
  if (opts.headerToken) {
    headers.set(CSRF_HEADER_NAME, opts.headerToken);
  }
  if (opts.contentType) {
    headers.set('content-type', opts.contentType);
  }
  // Annotating as the DOM `RequestInit` pulls in `signal: AbortSignal | null`,
  // but Next 16's NextRequest constructor uses its own RequestInit shape with
  // `signal?: AbortSignal | undefined`. Letting TS infer the literal type
  // sidesteps the incompatibility, `signal` isn't used in this test anyway.
  const init: { method: string; headers: Headers; body?: string } = {
    method: 'POST',
    headers,
  };
  if (opts.body !== undefined) {
    init.body = opts.body;
  }
  return new NextRequest('http://example.test/api/missions/create', init);
}

describe('requireCsrf', () => {
  it('passes when cookie + header tokens match', async () => {
    const req = makeRequest({ cookieToken: TOKEN, headerToken: TOKEN });
    await expect(requireCsrf(req)).resolves.toBeUndefined();
  });

  it('throws csrf-cookie-missing when no cookie set', async () => {
    const req = makeRequest({ headerToken: TOKEN });
    const err = await requireCsrf(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsrfError);
    expect((err as CsrfError).reason).toBe('csrf-cookie-missing');
  });

  it('throws csrf-token-missing when cookie present but no header / form', async () => {
    const req = makeRequest({ cookieToken: TOKEN });
    const err = await requireCsrf(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsrfError);
    expect((err as CsrfError).reason).toBe('csrf-token-missing');
  });

  it('throws csrf-token-mismatch when values differ', async () => {
    const req = makeRequest({ cookieToken: TOKEN, headerToken: OTHER_TOKEN });
    const err = await requireCsrf(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsrfError);
    expect((err as CsrfError).reason).toBe('csrf-token-mismatch');
  });

  it('throws csrf-token-mismatch when lengths differ', async () => {
    const req = makeRequest({ cookieToken: TOKEN, headerToken: 'short' });
    const err = await requireCsrf(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsrfError);
    expect((err as CsrfError).reason).toBe('csrf-token-mismatch');
  });

  it('accepts a form-field token on form-encoded posts', async () => {
    const body = new URLSearchParams({ [CSRF_FORM_FIELD]: TOKEN, foo: 'bar' }).toString();
    const req = makeRequest({
      cookieToken: TOKEN,
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    await expect(requireCsrf(req)).resolves.toBeUndefined();
  });

  it('rejects when form-encoded body has wrong csrf field', async () => {
    const body = new URLSearchParams({ [CSRF_FORM_FIELD]: OTHER_TOKEN }).toString();
    const req = makeRequest({
      cookieToken: TOKEN,
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    const err = await requireCsrf(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsrfError);
    expect((err as CsrfError).reason).toBe('csrf-token-mismatch');
  });

  it('prefers header over form field when both present', async () => {
    const body = new URLSearchParams({ [CSRF_FORM_FIELD]: OTHER_TOKEN }).toString();
    const req = makeRequest({
      cookieToken: TOKEN,
      headerToken: TOKEN,
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    await expect(requireCsrf(req)).resolves.toBeUndefined();
  });
});

describe('csrfErrorResponse', () => {
  it('returns a 403 with canonical error body', async () => {
    const err = new CsrfError('csrf-token-mismatch', 'test detail');
    const resp = csrfErrorResponse(err);
    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body).toEqual({ error: 'csrf-token-required', reason: 'csrf-token-mismatch' });
  });
});
