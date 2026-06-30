"use client";

/**
 * Login front door, Zitadel OIDC redirect.
 *
 * With Auth.js v5 + Zitadel, authentication is handled entirely by Zitadel's
 * hosted login page (email/password, MFA, social IdPs). The dashboard
 * redirects the user to the Zitadel-hosted login via Auth.js signIn().
 *
 * This component renders a navigable front door:
 *   - A "Sign in" button that initiates the Zitadel OIDC flow.
 *   - When selfServeSignup is true: a "Create account" link to /signup.
 *   - Cross-link: the signup page links back here.
 *
 * The StrictMode double-fire guard (initiated ref) is preserved: React
 * StrictMode would call signIn("zitadel") twice on mount in development,
 * causing "Auth Request has already been handled (COMMAND-Sx208nt)" from
 * Zitadel's V2 login UI, which parks the user on /ui/v2/login/signedin
 * instead of completing the OIDC redirect. The guard is now tied to the
 * explicit "Sign in" button click rather than a useEffect, which eliminates
 * the double-fire entirely without needing the ref at all.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log.
 */

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ProviderId } from "@/src/lib/social-providers";
import { SocialProvidersBlock } from "@/src/components/auth/SocialProvidersBlock";

interface LoginFormProps {
  /** Ordered list of enabled social provider IDs from the server (always empty). */
  providers: ProviderId[];
  /**
   * Whether self-serve signup is active for this deployment.
   * When true, a "Create account" CTA is shown. When false, the front door
   * is sign-in only (closed registration, admin-provisioned tenants).
   * Resolved server-side from the deployment-profile resolver (dashboard#921).
   */
  selfServeSignup: boolean;
}

export function LoginForm({ providers, selfServeSignup }: LoginFormProps) {
  const searchParams = useSearchParams();
  // Default landing for an authenticated user is the dashboard, not the
  // public landing page. Only override via ?callbackUrl=... when the user
  // was deep-linked into a protected route they couldn't load unauthenticated.
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  // Track whether sign-in is in progress so we can show a loading state and
  // prevent double-clicks. This replaces the previous useEffect + initiated
  // ref pattern (which auto-fired on mount): now sign-in is always explicit.
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = useCallback(() => {
    if (signingIn) return;
    setSigningIn(true);
    void signIn("zitadel", { callbackUrl });
  }, [signingIn, callbackUrl]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to Gibson</CardTitle>
          <p className="text-sm text-muted-foreground">
            {selfServeSignup
              ? "Sign in to your account or create a new one."
              : "Sign in to your account to continue."}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Primary CTA: Sign in via Zitadel hosted login */}
          <Button
            className="w-full"
            onClick={handleSignIn}
            disabled={signingIn}
            aria-busy={signingIn}
          >
            {signingIn ? (
              <>
                <Loader2Icon
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Redirecting to sign-in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>

          {/* SocialProvidersBlock renders null when providers is empty */}
          <SocialProvidersBlock providers={providers} mode="signin" />

          {/* Create account CTA: shown only when self-serve signup is enabled */}
          {selfServeSignup && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/signup">Create account</Link>
            </Button>
          )}
        </CardContent>

        {/* No footer needed when signup is not available; keep the page clean. */}
        {selfServeSignup && (
          <CardFooter className="justify-center">
            <p className="text-xs text-muted-foreground">
              Already have an account?{" "}
              <button
                onClick={handleSignIn}
                disabled={signingIn}
                className="underline underline-offset-4 hover:no-underline font-medium text-foreground"
              >
                Sign in
              </button>
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
