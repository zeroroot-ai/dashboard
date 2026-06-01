/**
 * @vitest-environment node
 *
 * Unit tests for POST /api/chat/attachment.
 *
 * Strategy:
 *  - Mock getServerSession so the auth gate is controllable.
 *  - Mock requireActiveTenant so the tenant gate is controllable.
 *  - Mock the UserService.stageAttachment RPC via userClient.
 *  - Mock pdf-parse so we don't load pdfjs-dist in unit tests.
 *  - Exercise the four canonical paths: accepted text, accepted PDF,
 *    413 (too large), 415 (disallowed type).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockGetServerSession, mockRequireActiveTenant, mockStageAttachment, mockPdfGetText, mockPdfDestroy } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockRequireActiveTenant: vi.fn(),
    mockStageAttachment: vi.fn(),
    mockPdfGetText: vi.fn(),
    mockPdfDestroy: vi.fn(),
  }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: (_err: unknown) =>
    new Response(JSON.stringify({ error: 'no_active_tenant', code: 'no_active_tenant' }), { status: 412 }),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: () => ({
    stageAttachment: (...args: unknown[]) => mockStageAttachment(...args),
  }),
}));

vi.mock('@/src/gen/gibson/user/v1/user_pb', () => ({
  UserService: {},
}));

vi.mock('@/src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// pdf-parse v2 ships a class API: new PDFParse({ data }).getText() → { text }.
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

function makeRequest(file: File | null): NextRequest {
  const form = new FormData();
  if (file) form.append('file', file);
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
    // Default: authenticated user with active tenant.
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
    });
    mockRequireActiveTenant.mockResolvedValue('tenant-1');
    // Default: daemon stageAttachment succeeds.
    mockStageAttachment.mockResolvedValue({ attachmentId: 'test-attachment-id-1234' });
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
    it('accepts a text/plain file, calls stageAttachment, and returns an attachmentId', async () => {
      const content = 'the quick brown fox';
      const file = new File([content], 'note.txt', { type: 'text/plain' });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(200);
      const json = (await res.json()) as { attachmentId: string };
      expect(json.attachmentId).toBe('test-attachment-id-1234');

      // stageAttachment called with correct args.
      expect(mockStageAttachment).toHaveBeenCalledOnce();
      const [req] = mockStageAttachment.mock.calls[0] as [{ tenantId: string; text: string; ttlSeconds: number }];
      expect(req.tenantId).toBe('tenant-1');
      expect(req.text).toBe(content);
      expect(req.ttlSeconds).toBe(0); // daemon default
    });

    it('accepts a PDF file, calls pdf-parse, and stages the extracted text', async () => {
      const extracted = 'Extracted PDF body text.';
      mockPdfGetText.mockResolvedValue({ text: extracted });

      const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
        type: 'application/pdf',
      });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(200);
      expect(mockPdfGetText).toHaveBeenCalledOnce();
      expect(mockStageAttachment).toHaveBeenCalledOnce();
      const [req] = mockStageAttachment.mock.calls[0] as [{ text: string }];
      expect(req.text).toBe(extracted);
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
      expect(mockStageAttachment).not.toHaveBeenCalled();
    });
  });

  describe('size limit', () => {
    it('returns 413 when the file is larger than 4 MB', async () => {
      const big = new Uint8Array(4 * 1024 * 1024 + 1).fill(0x41);
      const file = new File([big], 'big.txt', { type: 'text/plain' });
      const res = await POST(makeRequest(file));

      expect(res.status).toBe(413);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('File too large. Maximum size is 4 MB.');
      expect(mockStageAttachment).not.toHaveBeenCalled();
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
      expect(mockStageAttachment).not.toHaveBeenCalled();
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
