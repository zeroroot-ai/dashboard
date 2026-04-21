"use client";

/**
 * /signin/provide-email — redirects to Zitadel sign-in.
 *
 * The GitHub private-email flow that this page served is no longer needed
 * with Zitadel as the IdP — Zitadel handles email collection for social IdPs.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log.
 */

import { useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";

function ProvideEmailRedirect() {
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

export default function ProvideEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ProvideEmailRedirect />
    </Suspense>
  );
}
