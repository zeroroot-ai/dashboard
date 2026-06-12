"use client";

/**
 * Login form, Zitadel OIDC redirect.
 *
 * With Auth.js v5 + Zitadel, authentication is handled entirely by Zitadel's
 * hosted login page (email/password, MFA, social IdPs). The dashboard
 * redirects the user to the Zitadel-hosted login via Auth.js signIn().
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log. The email/password form, captcha, and social-provider
 * buttons previously rendered here are now rendered by Zitadel. This page
 * is a thin redirect shim until a branded Zitadel login theme is configured.
 */

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";
import type { ProviderId } from "@/src/lib/social-providers";
import { SocialProvidersBlock } from "@/src/components/auth/SocialProvidersBlock";

interface LoginFormProps {
  /** Ordered list of enabled social provider IDs from the server (always empty). */
  providers: ProviderId[];
}

export function LoginForm({ providers }: LoginFormProps) {
  const searchParams = useSearchParams();
  // Default landing for an authenticated user is the dashboard, not the
  // public landing page. Only override via ?callbackUrl=… when the user
  // was deep-linked into a protected route they couldn't load
  // unauthenticated.
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  // Immediately redirect to Zitadel hosted login. No email/password form
  // is rendered, credentials are collected by Zitadel.
  //
  // Hard guard against double-fire: React StrictMode (and any future
  // re-mounts triggered by router transitions) would otherwise call
  // signIn("zitadel") twice. Both POSTs hit the same Zitadel auth
  // request, the second one fails with "Auth Request has already been
  // handled (COMMAND-Sx208nt)", and the V2 login UI's error path
  // parks the user on /ui/v2/login/signedin instead of completing the
  // OIDC redirect back to /api/auth/callback/zitadel, leaving the
  // dashboard with no session cookie despite Zitadel showing the
  // user as signed in.
  const initiated = useRef(false);
  useEffect(() => {
    if (initiated.current) return;
    initiated.current = true;
    void signIn("zitadel", { callbackUrl });
  }, [callbackUrl]);

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2Icon className="h-8 w-8 animate-spin" />
        <span className="text-sm">Redirecting to sign-in…</span>
      </div>
      {/* SocialProvidersBlock renders null when providers is empty */}
      <SocialProvidersBlock providers={providers} mode="signin" />
    </div>
  );
}
