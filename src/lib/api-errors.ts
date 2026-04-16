/**
 * Standardised API error-response utilities.
 *
 * Ensures error messages never leak internal details in production
 * while still providing useful feedback during development.
 */

import { NextResponse } from 'next/server';
import { type ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a safe JSON error response.
 *
 * In development the original error message is returned so developers can
 * diagnose problems quickly. In every other environment the caller-supplied
 * `fallbackMessage` is used instead, preventing information leakage.
 */
export function safeErrorResponse(
  error: unknown,
  fallbackMessage: string,
  status: number = 500,
): NextResponse {
  console.error('[API Error]', error);

  const message =
    process.env.NODE_ENV === 'development' &&
    error instanceof Error
      ? error.message
      : fallbackMessage;

  return NextResponse.json(
    { success: false, error: message },
    { status },
  );
}

/**
 * Build a 400 response from a Zod validation error, returning per-field
 * error messages so the client can display inline feedback.
 */
export function validationErrorResponse(zodError: ZodError): NextResponse {
  return NextResponse.json(
    { success: false, errors: zodError.flatten().fieldErrors },
    { status: 400 },
  );
}
