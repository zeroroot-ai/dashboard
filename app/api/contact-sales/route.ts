import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { validationErrorResponse, safeErrorResponse } from '@/src/lib/api-errors';

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  company: z.string().min(1).max(100),
  companySize: z.enum(['1-50', '51-200', '201-1000', '1000+']),
  deployment: z.enum(['cloud', 'self-hosted', 'hybrid']),
  useCase: z.string().max(1000).optional(),
  timeline: z.enum(['asap', '1-3-months', '3-6-months', 'evaluating']),
});

export async function POST(request: NextRequest) {
  const rateLimitResult = await checkRateLimit(request, 'contact-sales', {
    maxRequests: 5,
    windowSeconds: 3600,
    algorithm: 'fixed_window' as const,
    message: 'Too many submissions. Please try again later.',
  });
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult);
  }

  try {
    const body = await request.json();
    const result = contactSchema.safeParse(body);
    if (!result.success) {
      return validationErrorResponse(result.error);
    }

    // TODO: Wire to email notification, CRM webhook, or Slack integration
    console.log('[ContactSales] New enterprise lead:', JSON.stringify(result.data));

    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to submit contact form', 500);
  }
}
