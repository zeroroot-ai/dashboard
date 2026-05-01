/**
 * Account Settings page.
 *
 * Read-only view of the signed-in user's identity + active workspace.
 * Editing is not exposed in the dashboard today — the IdP is a backend
 * implementation detail that should never surface to end users (no
 * "manage in Zitadel" deep-link, no provider name leakage). When the
 * dashboard grows in-app profile editing, it will proxy through a
 * dashboard-owned endpoint that calls the IdP server-side.
 *
 * Active-tenant info is included since users come here looking for their
 * workspace id when filing support requests.
 */
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { getMyMemberships } from "@/src/lib/auth/membership";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  let activeTenant: string | null = null;
  try {
    activeTenant = await getActiveTenant();
  } catch {
    // No active-tenant cookie — user hasn't picked one yet, or the cookie
    // pointed at a tenant they no longer belong to. Render gracefully.
  }
  const memberships = await getMyMemberships();
  const active = memberships.find((m) => m.tenantId === activeTenant);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            The signed-in identity associated with this dashboard session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name" value={session.user.name ?? "(not set)"} />
          <Field label="Email" value={session.user.email ?? "(not set)"} />
          <Field
            label="User ID"
            value={session.user.id}
            mono
            description="Include this when filing support requests."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active workspace</CardTitle>
          <CardDescription>
            Calls to the dashboard run in the context of one of your
            workspaces. Switch from the top-bar workspace picker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Workspace"
            value={active?.tenantName ?? activeTenant ?? "(none selected)"}
          />
          {active?.tenantId ? (
            <Field label="Workspace ID" value={active.tenantId} mono />
          ) : null}
          {active?.role ? <Field label="Role" value={active.role} /> : null}
          <Separator />
          <Button asChild variant="outline">
            <Link href="/select-tenant">Switch workspace</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  description,
  mono = false,
}: {
  label: string;
  value: string;
  description?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-sm font-medium">{label}</div>
      <div
        className={
          mono
            ? "rounded-md bg-muted px-2 py-1 font-mono text-sm"
            : "text-sm"
        }
      >
        {value}
      </div>
      {description ? (
        <p className="text-muted-foreground text-xs">{description}</p>
      ) : null}
    </div>
  );
}
