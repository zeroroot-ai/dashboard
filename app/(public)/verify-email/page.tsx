"use client";

/**
 * /verify-email, Zitadel handles email verification natively.
 *
 * With Auth.js v5 + Zitadel, email verification is performed by Zitadel
 * before the OIDC token is issued. This page is a placeholder that redirects
 * to sign-in if the user somehow lands here.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log. The resend-verification flow and signOutAction are
 * superseded by Zitadel's hosted verification flow. If a custom informational
 * page is needed post-registration, it should display without action buttons.
 */

import { useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";

function VerifyEmailContent() {
  useEffect(() => {
    void signIn("zitadel");
  }, []);

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2Icon className="h-8 w-8 animate-spin" />
        <span className="text-sm">Redirecting to sign-in…</span>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
