/**
 * @vitest-environment node
 *
 * Unit tests for POST /api/chat/attachment.
 *
 * Strategy:
 *  - Mock getServerSession so the auth gate is controllable.
 *  - Mock the Redis store helpers so we never hit a real Redis.
 *  - Mock pdf-parse so we don't load pdfjs-dist in unit tests.
 *  - Exercise the four canonical paths: accepted text, accepted PDF,
 *    413 (too large), 415 (disallowed type).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// `vi.mock` calls are hoisted above the top-level imports — any vi.fn() they
// reference must be declared via `vi.hoisted` so it lifts with them.

const { mockGetServerSession, mockSetStr, mockPdfGetText, mockPdfDestroy } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockSetStr: vi.fn(),
    mockPdfGetText: vi.fn(),
    mockPdfDestroy: vi.fn(),
  }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/redis-store', () => ({
  setStr: (...args: unknown[]) => mockSetStr(...args),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// pdf-parse v2 ships a class API: new PDFParse({ data }).getText() → { text }.
// Use a real function class so that `new PDFParse(...)` doesn't trip the
// "did not use 'function' or 'class' in its implementation" warning.
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    getText() {
      return mockPdfGetText();
    }
    destroy() {
      return mockPdfDestroy();
    }
  },
}));

// ---------------------------------------------------------------------------
// Import handler under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest carrying a multipart/form-data body with a single `file`
 * field. We construct via the global FormData / File primitives so the
 * runtime parses the boundary itself.
 */
function makeRequest(file: File | null): NextRequest {
  const form = new FormData();
  if (file) form.append('file', file);

  // `Request` accepts a FormData body directly and sets the boundary header.
  const req = new Request('http://localhost:3000/api/chat/attachment', {
    method: 'POST',
    body: form,
  });
  return new NextRequest(req);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat/attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user.
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
    });
    // Default: Redis write succeeds.
    mockSetStr.mockResolvedValue(undefined);
    mockPdfDestroy.mockResolvedValue(undefined);
  });

  describe('auth gate', () => {
    it('returns 401 when there is no session', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
      const res = await POST(makeRequest(file));
      expect(res.status).toBe(401);
    });
  });

  describe('accepted file types', () => {
    it('accepts a text/plain file, writes Redis, and returns an attachmentId', async () => {
      const content = 'the quick brown fox';
      const file = new File([content], 'note.txt', { type: 'text/plain' });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(200);
      const json = (await res.json()) as { attachmentId: string };

      // UUID v4 shape — randomUUID format.
      expect(json.attachmentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // Redis key + value + TTL written.
      expect(mockSetStr).toHaveBeenCalledOnce();
      const [key, value, ttl] = mockSetStr.mock.calls[0] as [string, string, number];
      expect(key).toBe(`chatattach:${json.attachmentId}`);
      expect(value).toBe(content);
      expect(ttl).toBe(3600);
    });

    it('accepts a PDF file, calls pdf-parse, and stores the extracted text', async () => {
      const extracted = 'Extracted PDF body text.';
      mockPdfGetText.mockResolvedValue({ text: extracted });

      // The bytes don't need to be a valid PDF since pdf-parse is mocked.
      const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
        type: 'application/pdf',
      });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(200);
      expect(mockPdfGetText).toHaveBeenCalledOnce();

      expect(mockSetStr).toHaveBeenCalledOnce();
      const [key, value, ttl] = mockSetStr.mock.calls[0] as [string, string, number];
      expect(key).toMatch(/^chatattach:[0-9a-f-]+$/i);
      expect(value).toBe(extracted);
      expect(ttl).toBe(3600);
    });

    it('returns 422 when PDF text extraction throws', async () => {
      mockPdfGetText.mockRejectedValue(new Error('pdfjs internal'));

      const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'broken.pdf', {
        type: 'application/pdf',
      });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(422);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Could not extract text from PDF.');
      expect(mockSetStr).not.toHaveBeenCalled();
    });
  });

  describe('size limit', () => {
    it('returns 413 when the file is larger than 4 MB', async () => {
      // Synthesise a >4 MB blob without allocating an actual 4 MB string in
      // every test loop — File.size from the constructor reflects byte length.
      const big = new Uint8Array(4 * 1024 * 1024 + 1).fill(0x41); // 'A'
      const file = new File([big], 'big.txt', { type: 'text/plain' });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(413);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('File too large. Maximum size is 4 MB.');
      expect(mockSetStr).not.toHaveBeenCalled();
    });
  });

  describe('mime gate', () => {
    it('returns 415 for image/png', async () => {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
        type: 'image/png',
      });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(415);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Unsupported file type. Allowed: text, JSON, PDF.');
      expect(mockSetStr).not.toHaveBeenCalled();
    });

    it('accepts application/json as a text-shaped payload', async () => {
      const file = new File(['{"a":1}'], 'data.json', { type: 'application/json' });
      const res = await POST(makeRequest(file));
      expect(res.status).toBe(200);
    });
  });

  describe('missing file field', () => {
    it('returns 400 when the file field is absent', async () => {
      const res = await POST(makeRequest(null));
      expect(res.status).toBe(400);
    });
  });
});
