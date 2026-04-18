/**
 * /verify-email/confirm — token-consumption endpoint (Server Component).
 *
 * Better Auth constructs verification URLs that point here with a `token`
 * query parameter. This page consumes the token server-side, then either:
 *
 *   Success → renders a confirmation message + auto-redirects to
 *              /dashboard/default after 2 seconds via <meta http-equiv="refresh">.
 *
 *   Failure → renders an ErrorDisplay with a "Resend verification" action
 *              linking back to /verify-email, letting the user request a
 *              fresh link without signing in again.
 *
 * Using a Server Component here means the token is never exposed to the
 * browser — the page is fully rendered server-side and the redirect is
 * handled by the meta-refresh rather than client-side navigation.
 */

import Link from "next/link";
import { verifyEmailAction } from "@/app/actions/auth/verify-email";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VerifyEmailConfirmPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  const result = await verifyEmailAction(token);

  if (result.ok) {
    return (
      <div className="flex items-center justify-center py-4 lg:h-screen">
        {/* Auto-redirect after 2 seconds. A <meta> in the body is non-standard
            but all major browsers honour it and Next.js App Router does not
            provide a server-side redirect-after-delay primitive. */}
        <meta httpEquiv="refresh" content="2;url=/dashboard/default" />

        <Card className="mx-auto w-[420px] text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Email verified</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your email address has been verified. You will be redirected to the
              dashboard in a moment.
            </p>
            <Button asChild className="w-full">
              <Link href="/dashboard/default">Go to dashboard now</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Failure path — resolve user-facing copy for the specific error code.
  const userError = resolveUserFacingError(result.code);

  // Override the action so "Request a new link" goes to /verify-email, not
  // /forgot-password (which is the generic TOKEN_EXPIRED/TOKEN_INVALID target
  // in the error table — correct for password-reset links but wrong here).
  const emailError = {
    ...userError,
    action: {
      label: "Resend verification email",
      href: "/verify-email",
    },
  };

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <ErrorDisplay error={emailError} className="mx-auto w-[420px]" />
    </div>
  );
}
