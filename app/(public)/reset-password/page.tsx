/**
 * Reset Password page — Server Component.
 *
 * Reads the `token` query parameter set by Better Auth's reset-password
 * callback redirect (`/reset-password/:token?callbackURL=/reset-password`
 * redirects to `/reset-password?token=TOKEN`).
 *
 * Also reads the `error` parameter: Better Auth sets `?error=INVALID_TOKEN`
 * when the token is missing or expired in the redirect path.
 *
 * This component does not make a network call to pre-validate the token —
 * Better Auth has no separate "validate only" endpoint, and pre-validation
 * would consume the token. Actual validation happens in `resetPasswordAction`
 * on submit.
 */

import { Suspense } from "react";
import { Loader2Icon } from "lucide-react";

import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";
import { ResetPasswordForm } from "./reset-password-form";

interface SearchParams {
  token?: string;
  error?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const errorParam = params.error ?? "";

  // Better Auth's redirect callback sets `?error=INVALID_TOKEN` for both
  // missing-token and expired-token redirects. Without a dedicated "is this
  // token expired vs invalid" API, we map to TOKEN_INVALID here. If Better
  // Auth ever surfaces a TOKEN_EXPIRED code in the query we handle it below.
  if (errorParam === "TOKEN_EXPIRED") {
    return (
      <TokenErrorPage code="TOKEN_EXPIRED" />
    );
  }

  if (errorParam === "INVALID_TOKEN" || (!token && errorParam)) {
    return (
      <TokenErrorPage code="TOKEN_INVALID" />
    );
  }

  if (!token) {
    return (
      <TokenErrorPage code="TOKEN_INVALID" />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ResetPasswordForm token={token} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Token error sub-component
// ---------------------------------------------------------------------------

function TokenErrorPage({
  code,
}: {
  code: "TOKEN_EXPIRED" | "TOKEN_INVALID";
}) {
  const error = resolveUserFacingError(code);
  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <ErrorDisplay error={error} className="mx-auto w-full max-w-md" />
    </div>
  );
}
