import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LangfuseClient,
  LangfuseUnavailableError,
} from '@/src/lib/langfuse-client';

function makeClient() {
  return new LangfuseClient({
    host: 'https://lf.example.com',
    publicKey: 'pk',
    secretKey: 'sk',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LangfuseClient.request JSON handling', () => {
  // Regression for dashboard#515: a 2xx response whose body is not valid JSON
  // (proxy HTML error page, empty body, gateway interstitial) must surface as
  // a typed LangfuseUnavailableError — which /api/traces maps to a 503 —
  // rather than a raw SyntaxError that escapes into the generic 500 banner.
  it('wraps an unparseable 2xx body as LangfuseUnavailableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        text: async () => '<html>502 Bad Gateway</html>',
      }),
    );

    await expect(makeClient().listTracesPaged({ page: 1, limit: 25 })).rejects.toBeInstanceOf(
      LangfuseUnavailableError,
    );
  });

  // Regression: Langfuse v3 parses `orderBy` as a JSON object { column, order }
  // (order ∈ ASC|DESC) and 400s on the legacy `orderBy=timestamp&order=DESC`
  // pair (ZodError at path ["orderBy","order"]). listTracesPaged must send the
  // JSON form and no bare `order` param.
  it('sends orderBy as a Langfuse v3 JSON object (not legacy orderBy/order pair)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [], meta: { page: 1, limit: 25, totalItems: 0, totalPages: 1 } }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await makeClient().listTracesPaged({ page: 1, limit: 25 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(JSON.parse(calledUrl.searchParams.get('orderBy') ?? '{}')).toEqual({
      column: 'timestamp',
      order: 'DESC',
    });
    // No separate legacy `order` param.
    expect(calledUrl.searchParams.has('order')).toBe(false);
  });

  it('returns the parsed page envelope on a well-formed 2xx body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          data: [{ id: 't1', name: 'trace-one', timestamp: '2026-01-01T00:00:00Z' }],
          meta: { page: 1, limit: 25, totalItems: 1, totalPages: 1 },
        }),
        text: async () => '',
      }),
    );

    const page = await makeClient().listTracesPaged({ page: 1, limit: 25 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ id: 't1', name: 'trace-one' });
    expect(page.meta.totalItems).toBe(1);
  });
});
