import React from "react";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";

/**
 * Account locked page — pure display. Shown after repeated sign-in failures
 * that triggered an account lockout.
 *
 * Provides two remediation paths:
 *  - Reset password link (also serves as the unlock mechanism since Better Auth
 *    sends a signed token that invalidates the lockout counter).
 *  - Return to sign in via the escape hatch built into ErrorDisplay.
 *
 * This page is intentionally stateless: it contains no server-side data
 * fetching and does not require a session. A locked user may not have a valid
 * session at all.
 */
export default function LockedPage() {
  const error = resolveUserFacingError("ACCOUNT_LOCKED");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ErrorDisplay error={error} className="w-full max-w-md" />
    </main>
  );
}
