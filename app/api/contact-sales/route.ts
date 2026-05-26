import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';
import { getEmailProvider } from '@/src/lib/email/provider';

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
  const subject = `[Sales] ${lead.company} (${lead.companySize}) — ${lead.timeline}`;
  const lines = [
    `Name:         ${lead.name}`,
    `Email:        ${lead.email}`,
    `Company:      ${lead.company}`,
    `Size:         ${lead.companySize}`,
    `Deployment:   ${lead.deployment}`,
    `Timeline:     ${lead.timeline}`,
    '',
    'Use case:',
    lead.useCase ?? '(none provided)',
  ];
  const text = lines.join('\n');
  const html = `<pre style="font-family: ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap;">${escapeHtml(text)}</pre>`;
  return { subject, html, text };
}

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
    const lead = result.data;

    // Dispatch via the configured email provider. In dev / kind clusters
    // DASHBOARD_EMAIL_PROVIDER defaults to "log" so the message is written
    // as a structured stdout line — picked up by Loki/Grafana the same as
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

    // Also a structured log line so the lead is grep-able in Loki even
    // when the email provider is `log` and we're effectively duplicating;
    // a single source of truth is better than missing a lead because the
    // SMTP host was misconfigured.
    console.log(
      JSON.stringify({
        event: 'contact_sales.submitted',
        company: lead.company,
        company_size: lead.companySize,
        deployment: lead.deployment,
        timeline: lead.timeline,
        // PII: log only what we need for prioritisation; full email lives
        // in the dispatched message itself.
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
