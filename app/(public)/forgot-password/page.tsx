"use client";

/**
 * Forgot password, Zitadel redirect.
 *
 * With Auth.js v5 + Zitadel, password reset is handled by Zitadel's hosted
 * login page (Forgot password link). This page redirects to Zitadel sign-in.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log. The previous email-input form and forgotPasswordAction
 * are superseded by Zitadel's hosted password reset.
 */

import { useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";

function ForgotPasswordRedirect() {
  useEffect(() => {
    void signIn("zitadel");
  }, []);

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2Icon className="h-8 w-8 animate-spin" />
        <span className="text-sm">Redirecting to password reset…</span>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ForgotPasswordRedirect />
    </Suspense>
  );
}
