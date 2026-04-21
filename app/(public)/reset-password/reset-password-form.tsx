"use client";

/**
 * Reset password — Zitadel redirect.
 *
 * With Auth.js v5 + Zitadel, password reset is handled by Zitadel's hosted
 * login page. This form is a placeholder that redirects to Zitadel sign-in.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log. The previous token-based reset form using
 * resetPasswordAction / checkPasswordAction is superseded by Zitadel's
 * hosted password reset flow.
 */

import { useEffect } from "react";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm(_props: ResetPasswordFormProps) {
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
