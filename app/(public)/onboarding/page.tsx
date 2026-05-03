import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { auth } from "@/auth";
import { getMyMemberships } from "@/src/lib/auth/membership";
import { DataPlaneProgressPanel } from "./DataPlaneProgressPanel";

/**
 * Zero-membership UX. A user lands here when they are signed in via Zitadel
 * but FGA returns no `tenant.member` tuples for their `sub`. The most common
 * causes are (a) signup not yet completed (tenant-operator hasn't reconciled
 * the new Tenant CR + FGA tuples), or (b) all of their previous memberships
 * were revoked.
 *
 * Replaces the pre-spec behavior where a tenantless signed-in user was force-
 * redirected to `/api/auth/federated-signout`, producing a sign-in loop.
 *
 * Task 34 (D8): when the user has just completed the signup flow and a Tenant
 * CR exists but FGA tuples haven't propagated yet, the DataPlaneProgressPanel
 * client component polls GET /api/onboarding/data-plane every 2 s and renders
 * real per-store provisioning progress instead of a static spinner.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Defensive: if memberships have been provisioned since the middleware
  // last looked, send the user straight to the picker / dashboard.
  const memberships = await getMyMemberships();
  if (memberships.length > 0) {
    redirect("/select-tenant");
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <Card>
        <CardHeader>
          <CardTitle>Welcome — let&apos;s set up your organization</CardTitle>
          <CardDescription>
            You are signed in, but you don&apos;t belong to any organization yet.
            Either finish creating your first organization, or wait a moment if
            you just completed signup — provisioning typically takes 30–60
            seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Live provisioning progress panel (D8).
              Polls the data-plane status route and shows per-store state.
              Only meaningful after the Tenant CR has been created by the
              operator; the route returns null states before that. */}
          <DataPlaneProgressPanel />

          <div className="border-t pt-4 space-y-3">
            <Link href="/signup">
              <Button>Create your first organization</Button>
            </Link>
            <p className="text-sm text-muted-foreground">
              Already created an org and waiting for it to provision? Refresh this
              page in a minute. If you are still stuck, contact support.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
