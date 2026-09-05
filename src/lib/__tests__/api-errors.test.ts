/**
 * Unit tests for the canonical ConnectError → HTTP response mapper.
 *
 * Spec: deploy#207 (epic one-code-path M11, "kill safeErrorResponse").
 *
 * Coverage:
 *   - Each of the 9 canonical classes round-trips ConnectError → body shape.
 *   - Each error response includes the correlation ID in BOTH the
 *     `x-correlation-id` header and the `error.correlationId` body field.
 *   - Upstream `x-correlation-id` header is forwarded verbatim.
 *   - Missing header → fresh `req-<base32 of uuid7>` correlation ID.
 *   - Empty-state vs error-state: 200 + [] is empty-state; non-2xx is error-state.
 *   - `validationErrorResponse` returns the canonical 400 shape with `fields`.
 *   - `safeErrorResponse` shim routes through the canonical mapper.
 */

import { describe, it, expect, vi } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import { z } from 'zod';
import {
  CORRELATION_HEADER,
  ERROR_CLASS_TABLE,
  classifyConnectCode,
  correlationIdFromRequest,
  daemonErrorResponse,
  generateCorrelationId,
  okResponse,
  safeErrorResponse,
  validationErrorResponse,
  type ErrorClass,
} from '../api-errors';

// ---------------------------------------------------------------------------
// Correlation ID format
// ---------------------------------------------------------------------------

describe('generateCorrelationId', () => {
  it('returns a `req-`-prefixed Crockford base32 string of length 30', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^req-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id.length).toBe(30);
  });

  it('is monotonic enough that two consecutive ids differ', () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
  });
});

describe('correlationIdFromRequest', () => {
  it('forwards a `x-correlation-id` header verbatim when present', () => {
    const incoming = 'req-INCOMING1234567890ABCDEFGH';
    const h = new Headers({ [CORRELATION_HEADER]: incoming });
    expect(correlationIdFromRequest(h)).toBe(incoming);
  });

  it('generates a fresh id when the header is absent', () => {
    const h = new Headers();
    const out = correlationIdFromRequest(h);
    expect(out).toMatch(/^req-/);
  });

  it('also accepts a plain header bag (no .get method)', () => {
    expect(correlationIdFromRequest({ 'x-correlation-id': 'req-FROM-BAG' })).toBe(
      'req-FROM-BAG',
    );
  });

  it('generates a fresh id when no headers argument given', () => {
    expect(correlationIdFromRequest(undefined)).toMatch(/^req-/);
  });
});

// ---------------------------------------------------------------------------
// Class table, every entry has a unique HTTP status and message
// ---------------------------------------------------------------------------

describe('ERROR_CLASS_TABLE', () => {
  it('has exactly 10 classes', () => {
    expect(Object.keys(ERROR_CLASS_TABLE)).toHaveLength(10);
  });

  it.each(Object.entries(ERROR_CLASS_TABLE))(
    'class %s has non-empty message + valid affordance + 4xx/5xx status',
    (_name, entry) => {
      expect(entry.message.length).toBeGreaterThan(20);
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus).toBeLessThan(600);
      expect([
        'sign_in',
        'back_to_dashboard',
        'retry',
        'retry_with_support',
        'upgrade',
        'status_page',
        'contact_support',
      ]).toContain(entry.affordance);
    },
  );

  it('FailedPrecondition class is warm + actionable (no panic words)', () => {
    // The slice's UX note specifies the message lands warmly. We
    // assert the absence of panic words rather than the exact copy so
    // this test survives wording polish.
    const msg = ERROR_CLASS_TABLE.failed_precondition.message.toLowerCase();
    expect(msg).not.toContain('error');
    expect(msg).not.toContain('failed');
    expect(msg).not.toContain('broken');
  });
});

// ---------------------------------------------------------------------------
// classifyConnectCode, 9-class collapse
// ---------------------------------------------------------------------------

describe('classifyConnectCode', () => {
  const cases: Array<[Code, ErrorClass]> = [
    [Code.Unauthenticated, 'unauthenticated'],
    [Code.PermissionDenied, 'permission_denied'],
    [Code.NotFound, 'not_found'],
    [Code.FailedPrecondition, 'failed_precondition'],
    [Code.Aborted, 'failed_precondition'],
    [Code.ResourceExhausted, 'resource_exhausted'],
    [Code.Unavailable, 'unavailable'],
    [Code.DeadlineExceeded, 'deadline_exceeded'],
    [Code.InvalidArgument, 'invalid_argument'],
    [Code.OutOfRange, 'invalid_argument'],
    [Code.AlreadyExists, 'invalid_argument'],
    [Code.Internal, 'internal'],
    [Code.Unimplemented, 'internal'],
    [Code.DataLoss, 'internal'],
    [Code.Unknown, 'internal'],
    [Code.Canceled, 'internal'],
  ];
  it.each(cases)('Code.%s maps to %s', (code, expected) => {
    expect(classifyConnectCode(code)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// daemonErrorResponse, body shape + correlation ID + HTTP code
// ---------------------------------------------------------------------------

interface ExpectedShape {
  cls: ErrorClass;
  http: number;
}

const CODE_TO_EXPECTED: Array<[Code, ExpectedShape]> = [
  [Code.Unauthenticated, { cls: 'unauthenticated', http: 401 }],
  [Code.PermissionDenied, { cls: 'permission_denied', http: 403 }],
  [Code.NotFound, { cls: 'not_found', http: 404 }],
  [Code.FailedPrecondition, { cls: 'failed_precondition', http: 412 }],
  [Code.ResourceExhausted, { cls: 'resource_exhausted', http: 429 }],
  [Code.Unavailable, { cls: 'unavailable', http: 503 }],
  [Code.DeadlineExceeded, { cls: 'deadline_exceeded', http: 504 }],
  [Code.InvalidArgument, { cls: 'invalid_argument', http: 400 }],
  [Code.Internal, { cls: 'internal', http: 500 }],
];

describe('daemonErrorResponse, every ConnectError class', () => {
  it.each(CODE_TO_EXPECTED)(
    'Code.%s → http %s with canonical body shape and correlation ID in header + body',
    async (code, expected) => {
      const log = vi.fn();
      const headers = new Headers({
        [CORRELATION_HEADER]: 'req-UPSTREAM12345678901234567X',
      });
      const err = new ConnectError('daemon detail', code);

      const res = daemonErrorResponse(err, { headers, log });

      // 1. HTTP status matches the table.
      expect(res.status).toBe(expected.http);

      // 2. Correlation ID forwarded into the response header.
      expect(res.headers.get(CORRELATION_HEADER)).toBe(
        'req-UPSTREAM12345678901234567X',
      );

      // 3. Body shape: { error: { class, message, affordance, correlationId } }
      const body = await res.json();
      expect(body.error.class).toBe(expected.cls);
      expect(body.error.correlationId).toBe('req-UPSTREAM12345678901234567X');
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(typeof body.error.affordance).toBe('string');

      // 4. The log hook was called once with the structured record.
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith({
        class: expected.cls,
        httpStatus: expected.http,
        code,
        correlationId: 'req-UPSTREAM12345678901234567X',
        detail: 'daemon detail',
      });
    },
  );

  it('mints a fresh correlation ID when no upstream header is present', async () => {
    const res = daemonErrorResponse(
      new ConnectError('boom', Code.Unavailable),
      { log: vi.fn() },
    );
    expect(res.status).toBe(503);
    const idHeader = res.headers.get(CORRELATION_HEADER);
    expect(idHeader).toMatch(/^req-/);
    const body = await res.json();
    expect(body.error.correlationId).toBe(idHeader);
  });

  it('maps a non-ConnectError JS Error to internal/500', async () => {
    const res = daemonErrorResponse(new Error('something else'), {
      log: vi.fn(),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.class).toBe('internal');
  });

  it('maps a thrown non-Error value to internal/500', async () => {
    const res = daemonErrorResponse('a string', { log: vi.fn() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.class).toBe('internal');
  });

  it('prefers the daemon-supplied message on InvalidArgument', async () => {
    const res = daemonErrorResponse(
      new ConnectError('field `name` must be non-empty', Code.InvalidArgument),
      { log: vi.fn() },
    );
    const body = await res.json();
    expect(body.error.class).toBe('invalid_argument');
    expect(body.error.message).toBe('field `name` must be non-empty');
  });

  it('uses the canonical message on Unavailable (does not surface daemon detail)', async () => {
    const res = daemonErrorResponse(
      new ConnectError('postgres connection refused: 127.0.0.1:5432', Code.Unavailable),
      { log: vi.fn() },
    );
    const body = await res.json();
    expect(body.error.message).toBe(
      ERROR_CLASS_TABLE.unavailable.message,
    );
    expect(body.error.message).not.toContain('postgres');
  });
});

// ---------------------------------------------------------------------------
// daemonErrorResponse, provisioning sub-classification (dashboard#260)
// ---------------------------------------------------------------------------

describe('daemonErrorResponse, provisioning sub-classification', () => {
  it('FailedPrecondition + "tenant data-plane not provisioned" → 503 with class provisioning', async () => {
    const log = vi.fn();
    const err = new ConnectError('tenant data-plane not provisioned', Code.FailedPrecondition);
    const res = daemonErrorResponse(err, { log });

    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error.class).toBe('provisioning');
    expect(body.error.affordance).toBe('retry');
    expect(body.error.message).toContain('workspace is being set up');
  });

  it('provisioning response includes Retry-After: 30 header', async () => {
    const log = vi.fn();
    const err = new ConnectError('tenant data-plane not provisioned', Code.FailedPrecondition);
    const res = daemonErrorResponse(err, { log });

    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('provisioning regex matches "tenant dataplane not provisioned" (no hyphen)', async () => {
    const log = vi.fn();
    const err = new ConnectError('tenant dataplane not provisioned', Code.FailedPrecondition);
    const res = daemonErrorResponse(err, { log });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.class).toBe('provisioning');
  });

  it('FailedPrecondition + unrelated message → 412 failed_precondition (unaffected)', async () => {
    const log = vi.fn();
    const err = new ConnectError('mission definition not found in namespace', Code.FailedPrecondition);
    const res = daemonErrorResponse(err, { log });

    expect(res.status).toBe(412);

    const body = await res.json();
    expect(body.error.class).toBe('failed_precondition');
    // No Retry-After for ordinary precondition failures.
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('non-provisioning errors do not get Retry-After header', async () => {
    const log = vi.fn();
    const err = new ConnectError('backend offline', Code.Unavailable);
    const res = daemonErrorResponse(err, { log });

    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('provisioning: correlation ID still present in header and body', async () => {
    const log = vi.fn();
    const headers = new Headers({ [CORRELATION_HEADER]: 'req-PROVISIONING12345678901234' });
    const err = new ConnectError('tenant data-plane not provisioned', Code.FailedPrecondition);
    const res = daemonErrorResponse(err, { headers, log });

    expect(res.headers.get(CORRELATION_HEADER)).toBe('req-PROVISIONING12345678901234');
    const body = await res.json();
    expect(body.error.correlationId).toBe('req-PROVISIONING12345678901234');
  });
});

// ---------------------------------------------------------------------------
// validationErrorResponse, 400 shape with fields
// ---------------------------------------------------------------------------

describe('validationErrorResponse', () => {
  it('returns 400 with class=invalid_argument and a `fields` map', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse({ name: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const res = validationErrorResponse(parsed.error);
    expect(res.status).toBe(400);
    expect(res.headers.get(CORRELATION_HEADER)).toMatch(/^req-/);

    const body = await res.json();
    expect(body.error.class).toBe('invalid_argument');
    expect(body.error.fields.name).toBeTruthy();
    expect(body.error.correlationId).toMatch(/^req-/);
  });
});

// ---------------------------------------------------------------------------
// okResponse, 200 + correlation ID on happy path
// ---------------------------------------------------------------------------

describe('okResponse', () => {
  it('returns 200 with the correlation ID header on happy path', async () => {
    const headers = new Headers({
      [CORRELATION_HEADER]: 'req-HAPPYPATH123456789012345AB',
    });
    const res = okResponse({ data: [{ id: '1' }] }, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get(CORRELATION_HEADER)).toBe(
      'req-HAPPYPATH123456789012345AB',
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  it('empty-state, 200 with empty array, distinct from error-state', async () => {
    const res = okResponse({ data: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    // No `error` field on 200.
    expect(body.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// safeErrorResponse, shim still produces canonical body
// ---------------------------------------------------------------------------

describe('safeErrorResponse (deprecated shim)', () => {
  it('routes through the canonical mapper (Unavailable → 503, class set)', async () => {
    const res = safeErrorResponse(
      new ConnectError('temp', Code.Unavailable),
      'Failed to load',
      500,
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.class).toBe('unavailable');
    expect(body.error.correlationId).toMatch(/^req-/);
  });
});
