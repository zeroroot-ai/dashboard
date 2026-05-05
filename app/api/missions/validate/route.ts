/**
 * Mission Validation API Route
 *
 * POST /api/missions/validate
 *
 * Server-side validation endpoint for mission YAML.
 * Performs comprehensive validation including:
 * - YAML syntax validation
 * - JSON Schema validation
 * - Custom business rules
 * - Optional integration with Gibson daemon for advanced checks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { validateMissionYAML, addLineNumbers } from '@/src/lib/mission/validation';
import type { ValidationResult } from '@/src/lib/mission/validation';
import { logger } from '@/src/lib/logger';

// ============================================================================
// Types
// ============================================================================

interface ValidateRequest {
  yaml: string;
  options?: {
    /** Perform deep validation with Gibson daemon */
    deepValidation?: boolean;
    /** Include schema documentation in response */
    includeDocumentation?: boolean;
  };
}

interface ValidateResponse extends ValidationResult {
  /** Server timestamp */
  timestamp: string;
  /** Validation source */
  source: 'client' | 'server';
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: ValidateRequest = await request.json();

    // Validate request
    if (!body.yaml || typeof body.yaml !== 'string') {
      return NextResponse.json(
        {
          isValid: false,
          errors: [{
            code: 'INVALID_REQUEST',
            message: 'Request body must include a "yaml" string field',
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
    if (body.yaml.length > 100 * 1024) {
      return NextResponse.json(
        {
          isValid: false,
          errors: [{
            code: 'CONTENT_TOO_LARGE',
            message: 'YAML content exceeds maximum size of 100KB',
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

    // Perform validation
    const result = validateMissionYAML(body.yaml);

    // Add line numbers to errors
    const errorsWithLines = addLineNumbers(body.yaml, result.errors);

    // Deep validation is requested but not yet wired to the Gibson daemon.
    // The ValidateMission RPC is still pending; until then, surface the
    // unavailability honestly so the UI can render the toggle as a hint
    // instead of pretending a full deep-validate ran.
    if (body.options?.deepValidation) {
      result.warnings.push({
        code: 'DEEP_VALIDATION_UNAVAILABLE',
        message:
          'Deep validation is not yet wired to the Gibson daemon. ' +
          'YAML, schema, and business-rule checks ran; daemon-side ' +
          'agent/tool/scope checks were skipped.',
        path: '',
        severity: 'warning',
      });
    }

    const response: ValidateResponse = {
      ...result,
      errors: errorsWithLines,
      duration: performance.now() - startTime,
      timestamp: new Date().toISOString(),
      source: 'server',
    };

    return NextResponse.json(response);
  } catch (err) {
    logger.error({ err, route: 'missions/validate' }, 'mission validation server error');

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
