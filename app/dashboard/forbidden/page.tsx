import React from "react";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerSession } from "@/src/lib/auth";
import { signOutAction } from "@/app/actions/auth/signout";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";

/**
 * Forbidden page — shown when a user tries to access a resource they do not
 * have permission for, or when a tenant-scoped user navigates to a workspace
 * they do not belong to.
 *
 * Behaviour:
 * - Unauthenticated visitors → redirect to /login.
 * - Authenticated users with multiple tenants → show tenant switcher buttons
 *   so they can switch to a workspace they have access to.
 * - Authenticated users with zero or one tenant → show only Sign out.
 *
 * This is a Server Component. Session data is fetched server-side so we can
 * render the correct set of CTAs without a client-side loading state.
 */
export default async function ForbiddenPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  const error = resolveUserFacingError("TENANT_FORBIDDEN");
  const tenants = session.user?.tenants ?? [];
  const hasMultipleTenants = tenants.length > 1;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card
        role="alert"
        aria-label={error.title}
        className="w-full max-w-md"
      >
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold leading-none">{error.title}</h1>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {error.description}
          </p>

          {hasMultipleTenants && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Switch to another workspace:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {tenants.map((tenantId) => (
                  <Button
                    key={tenantId}
                    asChild
                    variant="outline"
                    size="sm"
                    className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {/*
                     * The tenant switcher navigates to the workspace root.
                     * The (auth) layout will pick up the new active org
                     * from the session after Better Auth sets activeOrganizationId.
                     */}
                    <a href={`/dashboard?tenant=${encodeURIComponent(tenantId)}`}>
                      {tenantId}
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter>
          <form
            action={async () => {
              "use server";
              await signOutAction();
            }}
          >
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
