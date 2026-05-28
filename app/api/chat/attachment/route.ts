/**
 * Chat Attachment API Route
 *
 * POST /api/chat/attachment - Upload a single file, extract its text content,
 * and stash it in Redis under a short-lived token. The chatbot then passes
 * the returned `attachmentId` on its next message so the chat route can
 * inject the file content into the conversation as a user message.
 *
 * Limits:
 * - Max size: 4 MB
 * - Allowed types: text/*, application/json, application/pdf
 *
 * Storage:
 * - Key: chatattach:{uuid}
 * - TTL: 1 hour (single-use; chat route deletes after read)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { setStr } from '@/src/lib/redis-store';
import { logger } from '@/src/lib/logger';

// ============================================================================
// Constants
// ============================================================================

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
const TTL_SECONDS = 60 * 60; // 1 hour
const REDIS_KEY_PREFIX = 'chatattach:';

const ALLOWED_NON_TEXT_MIME = new Set<string>([
  'application/json',
  'application/pdf',
]);

function isAllowedMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  return ALLOWED_NON_TEXT_MIME.has(mime);
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  // Auth
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart/form-data payload.' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing required `file` field.' },
      { status: 400 },
    );
  }

  // Size gate
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 4 MB.' },
      { status: 413 },
    );
  }

  // Type gate
  const mime = file.type || 'application/octet-stream';
  if (!isAllowedMime(mime)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Allowed: text, JSON, PDF.' },
      { status: 415 },
    );
  }

  // Extract text content
  let text: string;
  try {
    if (mime === 'application/pdf') {
      text = await extractPdfText(file);
    } else {
      text = await file.text();
    }
  } catch (err) {
    if (err instanceof PdfExtractionError) {
      return NextResponse.json(
        { error: 'Could not extract text from PDF.' },
        { status: 422 },
      );
    }
    logger.error(
      { err, route: 'chat/attachment', mime },
      'attachment extraction failed',
    );
    return NextResponse.json(
      { error: 'Could not read file content.' },
      { status: 422 },
    );
  }

  // Stash in Redis
  const id = crypto.randomUUID();
  await setStr(`${REDIS_KEY_PREFIX}${id}`, text, TTL_SECONDS);

  return NextResponse.json({ attachmentId: id }, { status: 200 });
}

// ============================================================================
// Helpers
// ============================================================================

class PdfExtractionError extends Error {
  constructor(cause?: unknown) {
    super('pdf extraction failed');
    this.name = 'PdfExtractionError';
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Extract text from a PDF using pdf-parse v2's class-based API.
 * Throws PdfExtractionError on any failure.
 */
async function extractPdfText(file: File): Promise<string> {
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    // pdf-parse is dynamically imported so its pdfjs-dist dependency is only
    // loaded when a PDF actually shows up — keeps cold-start light.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (err) {
    throw new PdfExtractionError(err);
  }
}
