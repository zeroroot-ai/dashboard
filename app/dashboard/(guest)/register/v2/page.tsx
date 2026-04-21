"use client";

/**
 * Register v2 — redirects to Zitadel sign-in.
 *
 * The email/password registration form is superseded by Zitadel's hosted
 * registration flow. This page redirects to Zitadel sign-in.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log.
 */

import { useEffect } from "react";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";

export default function Page() {
  useEffect(() => {
    void signIn("zitadel");
  }, []);

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2Icon className="h-8 w-8 animate-spin" />
        <span className="text-sm">Redirecting to sign-up…</span>
      </div>
    </div>
  );
}
