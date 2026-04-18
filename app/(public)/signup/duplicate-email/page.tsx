/**
 * /signup/duplicate-email — direct navigation target for the
 * EMAIL_ALREADY_REGISTERED error case.
 *
 * Renders the ErrorDisplay card for users who arrive here via a direct link
 * (e.g. a support article, or an automated redirect from a third-party
 * integration). The correlationId is read from the `ref` query param when
 * present so support teams can cross-reference with server logs.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";

export const metadata: Metadata = {
  title: "Email already registered — Zero Day AI",
};

/**
 * Reads the optional `ref` search param (correlation ID) so the ErrorDisplay
 * card shows a "Reference: <id>" footer when it is available — useful for
 * support escalations.
 */
interface PageProps {
  searchParams: Promise<{ ref?: string }>;
}

async function DuplicateEmailContent({ searchParams }: PageProps) {
  const params = await searchParams;
  const correlationId = typeof params.ref === "string" && params.ref.length > 0
    ? params.ref
    : undefined;

  const error = resolveUserFacingError(
    "EMAIL_ALREADY_REGISTERED",
    correlationId,
  );

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <ErrorDisplay error={error} className="w-full" />
      </div>
    </div>
  );
}

export default function DuplicateEmailPage(props: PageProps) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DuplicateEmailContent {...props} />
    </Suspense>
  );
}
