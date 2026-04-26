/**
 * Deterministic auth-failure error page.
 *
 * Replaces the silent federated-signout loop the dashboard had pre-spec.
 * Reads `?reason=<code>`, runs `safeReason()` to whitelist the value,
 * renders user-facing copy + an actionable CTA + an opaque correlation
 * ID for support to track. Server-rendered; works with JS disabled. No
 * untrusted input is ever echoed raw.
 *
 * Spec: auth-resolution-hardening (R2).
 */
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { ERROR_COPY, safeReason, type LoginErrorReason } from "@/src/lib/auth/error-codes";
import { readCorrelationId } from "@/src/lib/auth/correlation";
import { incrementLoginError } from "@/src/lib/metrics/auth";

interface PageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function LoginErrorPage({ searchParams }: PageProps) {
  const { reason: rawReason } = await searchParams;
  const reason: LoginErrorReason = safeReason(rawReason);
  const copy = ERROR_COPY[reason];
  const correlationId = await readCorrelationId();

  // Telemetry — fire-and-emit; never throws inside the renderer.
  try {
    incrementLoginError(reason);
    // Structured log; emitted to stderr so the platform's log shipper picks it up.
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "auth.login_error",
        reason,
        correlation_id: correlationId,
      }),
    );
  } catch {
    // Never fail the page on a metric-emit error.
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link href={copy.cta.href}>
            <Button>{copy.cta.label}</Button>
          </Link>
          <p className="text-xs text-muted-foreground font-mono">
            Correlation ID: {correlationId}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
