/**
 * POST /api/auth/forgot-password
 *
 * Initiates a password reset flow for the given email address by delegating
 * to the DaemonAdminService.ResetPassword RPC, which in turn triggers the
 * Better Auth password-reset flow.
 *
 * Security: always returns { success: true } regardless of whether the email
 * exists, preventing email enumeration attacks.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';

const schema = z.object({
  email: z.string().email(),
  tenantId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  // Rate limit: 5 per hour per IP (sensitive endpoint)
  const rateLimitResult = await checkRateLimit(request, 'auth:forgot-password', {
    maxRequests: 5,
    windowSeconds: 3600,
    algorithm: 'fixed_window' as const,
    message: 'Too many password reset attempts. Please try again later.',
  });
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult);
  }

  try {
    const body = await request.json();
    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
      // Always return success — no email enumeration.
      return NextResponse.json({ success: true });
    }

    const { email, tenantId } = parseResult.data;

    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonAdminService } = await import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({ baseUrl: serverConfig.gibsonDaemonUrl });
    const client = createClient(DaemonAdminService, transport);

    await client.resetPassword({ email, tenantId: tenantId ?? '' });
  } catch (error) {
    // Log at WARN — do not expose error details to the caller.
    console.warn('[ForgotPassword] daemon ResetPassword error:', error);
  }

  // Always return success regardless of daemon outcome.
  return NextResponse.json({ success: true });
}
