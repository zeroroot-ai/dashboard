/**
 * Account Settings page.
 *
 * Source-of-truth for the user's profile is Zitadel. Rather than mirror it
 * in the dashboard (and risk drift), this page surfaces the live session
 * fields read-only and deep-links to Zitadel's self-service console for
 * the editable bits (display name, password, MFA, linked social accounts).
 *
 * Active-tenant info is included since users frequently come here looking
 * for their tenant id when filing support requests.
 */
import Link from "next/link";
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
import { ExternalLinkIcon } from "lucide-react";

const ZITADEL_ISSUER =
  process.env.ZITADEL_ISSUER ?? "https://auth.zero-day.local";
const ZITADEL_SELF_SERVICE_URL = `${ZITADEL_ISSUER}/ui/console/users/me`;

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
            Your identity is managed by Zitadel. Edit display name, password,
            and multi-factor authentication in the Zitadel self-service
            console.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name" value={session.user.name ?? "(not set)"} />
          <Field label="Email" value={session.user.email ?? "(not set)"} />
          <Field
            label="User ID"
            value={session.user.id}
            mono
            description="Zitadel-issued numeric subject. Include this when filing support requests."
          />
          <Separator />
          <Button asChild variant="outline">
            <Link href={ZITADEL_SELF_SERVICE_URL} target="_blank" rel="noreferrer">
              Manage profile in Zitadel
              <ExternalLinkIcon className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active workspace</CardTitle>
          <CardDescription>
            Calls to the dashboard run in the context of one of your tenants.
            Switch from the top-bar tenant picker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Tenant"
            value={active?.tenantName ?? activeTenant ?? "(none selected)"}
          />
          {active?.tenantId ? (
            <Field label="Tenant ID" value={active.tenantId} mono />
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
