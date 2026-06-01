import React from "react";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getServerSession } from "@/src/lib/auth";

/**
 * No-workspace page — defensive fallback.
 *
 * Post-`dashboard-native-signup` this page should be unreachable during
 * normal operation: `signupAction` always applies a Tenant CR + TenantMember
 * before redirecting the user to OIDC sign-in, so every signed-in user
 * arrives at `/dashboard` with an active tenant cookie set (resolved via
 * `requireActiveTenant()` from the `gibson_active_tenant` HMAC-signed cookie
 * + FGA membership lookup — see `tenant-membership-not-in-jwt`, dashboard#583).
 * Middleware additionally redirects tenantless users to `/api/auth/federated-signout`.
 *
 * This page exists only for a narrow diagnostic case: an operator-side
 * failure after signup completed (Tenant CR deleted out from under the
 * user, Zitadel org removed manually, etc.). Showing a "Create workspace"
 * link would loop the user back through signup — wrong for this scenario.
 * Instead, we offer sign-out and a support hand-off.
 *
 * Spec: dashboard-native-signup task 20.
 */
export default async function NoWorkspacePage() {
  const session = await getServerSession();

  // Not signed in — normal flow.
  if (!session) {
    redirect("/login");
  }

  // Has a tenant membership — page should not have been reached.
  // session.user.tenantId was removed in dashboard#583 lock-in;
  // use the membership list instead.
  if (session.user?.tenants && session.user.tenants.length > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card
        role="alert"
        aria-label="Couldn't load your workspace"
        className="w-full max-w-md"
      >
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold leading-none">
              Couldn&apos;t load your workspace
            </h1>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your account is signed in but we can&apos;t find a workspace
            associated with it. This is usually a temporary issue — please
            sign out and back in to retry. If it persists, contact support.
          </p>

          <p className="text-muted-foreground text-sm leading-relaxed">
            <a
              href="mailto:support@zeroroot.ai"
              className="underline underline-offset-4 hover:text-foreground"
            >
              support@zeroroot.ai
            </a>
          </p>
        </CardContent>

        <CardFooter>
          {/*
            Federated sign-out — clears the Auth.js cookie AND ends the
            Zitadel session (so the next /login doesn't silently re-auth).
            Deliberately NO "Create workspace" button: workspace creation
            happens at /signup only, and linking here would loop a
            tenant-stuck user back through signup with no effect.
          */}
          <form method="post" action="/api/auth/federated-signout">
            <button
              type="submit"
              className="text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              Sign out
            </button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
