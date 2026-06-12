/**
 * Chat Attachment API Route
 *
 * POST /api/chat/attachment, Upload a single file, extract its text content,
 * and stage it in the daemon via UserService.StageAttachment under a
 * short-lived token. The chatbot then passes the returned `attachmentId` on
 * its next message so the chat route can inject the file content into the
 * conversation as a user message.
 *
 * Limits:
 * - Max size: 4 MB
 * - Allowed types: text/*, application/json, application/pdf
 *
 * Storage:
 * - Daemon-managed Redis via StageAttachment RPC (single-use GETDEL).
 * - TTL: 1 hour (daemon default).
 *
 * Replaces the previous direct-Redis implementation.
 * Spec: dashboard-no-backing-store-clients (Module 5 / issue #589).
 */

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import { logger } from '@/src/lib/logger';

// ============================================================================
// Constants
// ============================================================================

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB

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

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
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

  // Stage in daemon (single-use, TTL 1 hour by default).
  try {
    const resp = await userClient(UserService).stageAttachment({
      tenantId,
      text,
      ttlSeconds: 0, // 0 = daemon default (3600s)
    });
    return NextResponse.json({ attachmentId: resp.attachmentId }, { status: 200 });
  } catch (err) {
    logger.error({ err, route: 'chat/attachment' }, 'stageAttachment RPC failed');
    return NextResponse.json(
      { error: 'Could not stage attachment.' },
      { status: 500 },
    );
  }
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
    // loaded when a PDF actually shows up, keeps cold-start light.
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
