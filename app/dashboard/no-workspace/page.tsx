import React from "react";
import Link from "next/link";
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
import { listPendingInvitationsAction } from "@/app/actions/auth/invitations";

/**
 * No-workspace page — shown when an authenticated user has no organization
 * memberships yet. Provides three possible next steps:
 *
 * 1. Create a workspace (always shown).
 * 2. Accept a pending invitation (shown only when the org adapter returns
 *    at least one pending, non-expired invitation for this user's email).
 * 3. Sign out.
 *
 * This is a Server Component: session and pending-invitation data are fetched
 * on the server so the page renders without any client-side loading state.
 */
export default async function NoWorkspacePage() {
  const session = await getServerSession();

  // If the user is not signed in at all, send them to login.
  if (!session) {
    redirect("/login");
  }

  // If the user already has a workspace, redirect into the dashboard.
  if (
    session.user?.tenantId ||
    (session.user?.tenants && session.user.tenants.length > 0)
  ) {
    redirect("/dashboard");
  }

  // Fetch pending invitations addressed to this user's email.
  const invResult = await listPendingInvitationsAction();
  const hasPendingInvitations =
    invResult.ok && invResult.invitations.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card
        role="alert"
        aria-label="No workspace found"
        className="w-full max-w-md"
      >
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold leading-none">
              No workspace found
            </h1>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your account is not part of any workspace yet. Create a new workspace
            to get started, or accept a pending invitation if you have been
            invited to an existing one.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              asChild
              className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Link href="/signup">Create workspace</Link>
            </Button>

            {hasPendingInvitations && (
              <Button
                asChild
                variant="outline"
                className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {/*
                 * Redirect to the accept-invitation flow. The invitations list
                 * page shows all pending invitations the user can accept.
                 */}
                <Link href="/dashboard/invitations">Accept invitation</Link>
              </Button>
            )}
          </div>
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
