/**
 * Mission Validation API Route
 *
 * POST /api/missions/validate
 *
 * Server-side validation endpoint for mission CUE source.
 * Delegates to the daemon's ValidateMissionCUE RPC via the CUE editor
 * server action and returns a ValidationResult-shaped response the
 * useMissionValidation hook and Monaco marker pipeline can consume.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { logger } from '@/src/lib/logger';
import { validateMissionCUEAction } from '@/app/actions/missions/cue-editor';
import type { ValidationError, ValidationWarning } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

interface ValidateRequest {
  /** CUE source text to validate */
  cueSource?: string;
  /** Legacy field — kept for one-cycle back-compat; ignored */
  yaml?: string;
}

interface ValidateResponse {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  parsed: Record<string, unknown> | null;
  duration: number;
  timestamp: string;
  source: 'server';
}

// ============================================================================
// Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = performance.now();

  try {
    // CSRF — zero-trust-hardening Req 11.5
    try {
      await requireCsrf(request);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }

    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: ValidateRequest = await request.json();
    const cueSource = body.cueSource ?? body.yaml ?? '';

    if (typeof cueSource !== 'string') {
      return NextResponse.json(
        {
          isValid: false,
          errors: [{
            code: 'INVALID_REQUEST',
            message: 'Request body must include a "cueSource" string field',
            path: '',
            severity: 'error',
          }],
          warnings: [],
          parsed: null,
          duration: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'server',
        } satisfies ValidateResponse,
        { status: 400 }
      );
    }

    // Check content length (max 100KB)
    if (cueSource.length > 100 * 1024) {
      return NextResponse.json(
        {
          isValid: false,
          errors: [{
            code: 'CONTENT_TOO_LARGE',
            message: 'CUE source exceeds maximum size of 100KB',
            path: '',
            severity: 'error',
          }],
          warnings: [],
          parsed: null,
          duration: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'server',
        } satisfies ValidateResponse,
        { status: 400 }
      );
    }

    // Delegate to the daemon's ValidateMissionCUE RPC via the server action.
    const diagnostics = await validateMissionCUEAction(cueSource);

    const errors: ValidationError[] = diagnostics
      .filter((d) => d.severity === 'error' || d.severity === 'ERROR')
      .map((d) => ({
        code: 'CUE_ERROR',
        message: d.message,
        path: '',
        line: d.line,
        column: d.col,
        severity: 'error' as const,
      }));

    const warnings: ValidationWarning[] = diagnostics
      .filter((d) => d.severity !== 'error' && d.severity !== 'ERROR')
      .map((d) => ({
        code: 'CUE_WARNING',
        message: d.message,
        path: '',
        line: d.line,
        severity: 'warning' as const,
      }));

    const response: ValidateResponse = {
      isValid: errors.length === 0,
      errors,
      warnings,
      parsed: null,
      duration: performance.now() - startTime,
      timestamp: new Date().toISOString(),
      source: 'server',
    };

    return NextResponse.json(response);
  } catch (err) {
    logger.error({ err, route: 'missions/validate' }, 'mission CUE validation server error');

    return NextResponse.json(
      {
        isValid: false,
        errors: [{
          code: 'SERVER_ERROR',
          message: 'An unexpected error occurred during validation',
          path: '',
          severity: 'error',
        }],
        warnings: [],
        parsed: null,
        duration: performance.now() - startTime,
        timestamp: new Date().toISOString(),
        source: 'server',
      } satisfies ValidateResponse,
      { status: 500 }
    );
  }
}

// ============================================================================
// Health Check
// ============================================================================

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    status: 'ok',
    service: 'mission-validation',
    timestamp: new Date().toISOString(),
  });
}
