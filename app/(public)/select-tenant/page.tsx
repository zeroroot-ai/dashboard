import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { auth } from "@/auth";
import { getMyMemberships } from "@/src/lib/auth/membership";
import { setActiveTenant } from "@/src/lib/auth/active-tenant";
import { pickTenantAction } from "./actions";

interface PageProps {
  searchParams: Promise<{ return_to?: string }>;
}

export default async function SelectTenantPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const memberships = await getMyMemberships();
  const { return_to: returnTo } = await searchParams;

  // Zero memberships → onboarding (also handled by middleware, but route-
  // direct visitors land here too).
  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  // Single membership → set the cookie and forward without rendering.
  if (memberships.length === 1) {
    const only = memberships[0];
    if (only) {
      await setActiveTenant(only.tenantId);
      redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard");
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-2xl font-semibold">Select an organization</h1>
      <p className="mb-6 text-muted-foreground">
        You belong to multiple organizations. Pick which one to act in for this
        session — you can switch at any time from the top bar.
      </p>

      <div className="space-y-3">
        {memberships.map((m) => (
          <Card key={m.tenantId}>
            <CardHeader>
              <CardTitle>{m.tenantName}</CardTitle>
              <CardDescription>
                Role: <span className="font-medium">{m.role}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={pickTenantAction}>
                <input type="hidden" name="tenant_id" value={m.tenantId} />
                <input
                  type="hidden"
                  name="return_to"
                  value={returnTo ?? "/dashboard"}
                />
                <Button type="submit" variant="default">
                  Continue as {m.tenantName}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
