import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';
import { getEmailProvider } from '@/src/lib/email/provider';
import { loadHostSplitConfig } from '@/src/lib/host-routing';
import { logger } from '@/src/lib/logger';

/**
 * POST /api/contact-sales — turn a sales enquiry into an email to the inbox.
 *
 * Restored after dashboard#911 deleted it alongside the marketing pages. The
 * pages moved to the marketing site (zeroroot-ai/www); this endpoint could
 * not follow them, because that site is a static build served by nginx with
 * no request-time server. So the form lives there and posts here.
 *
 * That makes the request cross-origin, which the original never was. The
 * allowlist is a single origin, WWW_URL — the same config the middleware's
 * host split reads, wired by the Helm chart from `global.domain`. Nothing is
 * hardcoded, and nothing is reflected back from the caller's Origin header.
 *
 * Self-hosted installs leave WWW_URL unset. There is no marketing site to
 * post from, so no CORS headers are emitted and the endpoint stays
 * same-origin only.
 */

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  company: z.string().min(1).max(100),
  companySize: z.enum(['1-50', '51-200', '201-1000', '1000+']),
  deployment: z.enum(['cloud', 'self-hosted', 'hybrid']),
  useCase: z.string().max(1000).optional(),
  timeline: z.enum(['asap', '1-3-months', '3-6-months', 'evaluating']),
});

const SALES_INBOX = process.env.CONTACT_SALES_INBOX ?? 'sales@zeroroot.ai';
const FROM_ADDR =
  process.env.DASHBOARD_EMAIL_FROM ?? 'noreply@zeroroot.ai';

/**
 * CORS headers for the one allowed origin, or none.
 *
 * Returns headers only when the caller's Origin exactly matches WWW_URL's
 * origin. An unknown Origin gets no CORS headers at all, so the browser
 * blocks the response — a deny is the absence of a grant, never an echo of
 * whatever the caller asked for.
 */
function corsHeaders(request: NextRequest): Record<string, string> {
  const split = loadHostSplitConfig();
  if (!split) return {};
  const origin = request.headers.get('origin');
  if (!origin || origin !== split.wwwOrigin) return {};
  return {
    'Access-Control-Allow-Origin': split.wwwOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    // The form posts with credentials omitted; say so rather than opening
    // the endpoint to cookie-bearing cross-origin requests.
    Vary: 'Origin',
  };
}

function withCors(response: NextResponse, request: NextRequest): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    response.headers.set(k, v);
  }
  return response;
}

/** Preflight for the cross-origin form post. */
export async function OPTIONS(request: NextRequest) {
  const headers = corsHeaders(request);
  // No allowlisted origin → no grant. 403 rather than a silent 200 so a
  // misconfigured WWW_URL is visible in the network tab instead of looking
  // like an opaque CORS failure.
  if (Object.keys(headers).length === 0) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Lead = z.infer<typeof contactSchema>;

function renderLead(lead: Lead): { subject: string; html: string; text: string } {
  const subject = `[Sales] ${lead.company} (${lead.companySize}), ${lead.timeline}`;
  const lines = [
    `Name:         ${lead.name}`,
    `Email:        ${lead.email}`,
    `Company:      ${lead.company}`,
    `Size:         ${lead.companySize}`,
    `Deployment:   ${lead.deployment}`,
    `Timeline:     ${lead.timeline}`,
    '',
    'Use case:',
    lead.useCase?.trim() || '(not provided)',
  ];
  const text = lines.join('\n');
  const html = `<pre style="font-family:ui-monospace,monospace">${escapeHtml(text)}</pre>`;
  return { subject, html, text };
}

/**
 * @csrf-exempt: posted cross-origin by the static marketing site (`www`), which
 * nginx serves with no request-time server, so the caller has no cookie on this
 * origin to double-submit and never will. Guarded instead by an exact-match
 * Origin allowlist of one (WWW_URL), an unauthenticated schema-validated body
 * that only ever produces an email to a fixed inbox, and a rate limit. There is
 * no user session to ride, so there is nothing for a forged request to abuse.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await checkRateLimit(request, 'contact-sales', {
    maxRequests: 5,
    windowSeconds: 3600,
    algorithm: 'fixed_window' as const,
    message: 'Too many submissions. Please try again later.',
  });
  if (!rateLimitResult.allowed) {
    return withCors(createRateLimitResponse(rateLimitResult) as NextResponse, request);
  }

  try {
    const body = await request.json();
    const result = contactSchema.safeParse(body);
    if (!result.success) {
      return withCors(validationErrorResponse(result.error) as NextResponse, request);
    }
    const lead = result.data;

    // Dispatch via the configured email provider. In dev / kind clusters
    // DASHBOARD_EMAIL_PROVIDER defaults to "log" so the message is written
    // as a structured stdout line, picked up by Loki/Grafana the same as
    // any other server log. In production overlays the provider is set to
    // smtp/resend and the message is delivered to CONTACT_SALES_INBOX.
    const { subject, html, text } = renderLead(lead);
    const message = {
      to: SALES_INBOX,
      subject,
      html,
      text,
      headers: {
        'Reply-To': lead.email,
        'X-Lead-Source': 'contact-sales-form',
      },
    };
    await getEmailProvider().send(message);

    // Also a structured log line so the lead is grep-able even when the
    // email provider is `log` and we are effectively duplicating; a
    // duplicate beats losing a lead because the SMTP host was misconfigured.
    //
    // The original wrote this with console.log + JSON.stringify. It goes
    // through the canonical pino logger now, which is the repo's only
    // approved server-side logging surface — same stdout JSON, and the
    // redactor is applied. Identifying values stay in the structured
    // object, never in the message string.
    logger.info(
      {
        event: 'contact_sales.submitted',
        company: lead.company,
        company_size: lead.companySize,
        deployment: lead.deployment,
        timeline: lead.timeline,
        // PII: only what prioritisation needs; the full email address
        // lives in the dispatched message itself.
      },
      'contact sales lead submitted',
    );

    return withCors(NextResponse.json({ success: true }), request);
  } catch (error) {
    return withCors(daemonErrorResponse(error, { headers: request.headers }) as NextResponse, request);
  }
}
