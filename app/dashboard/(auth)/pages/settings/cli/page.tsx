import { type Metadata } from "next";

import { generateMeta } from "@/lib/utils";
import { env } from "@/src/lib/env-validator";
import { readRawActiveTenant } from "@/src/lib/auth/active-tenant";
import { CliCommandsCard } from "@/components/gibson/settings/CliCommandsCard";
import { SessionsTable } from "@/components/gibson/settings/SessionsTable";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — CLI",
    additionalTitle: true,
    description:
      "Connect the gibson CLI to this tenant: copy-pasteable login and component check-in commands.",
    canonical: "/pages/settings/cli",
  });
}

/**
 * /dashboard/pages/settings/cli — every member. Renders the CLI
 * command-reference card pre-filled with this tenant's slug and the public
 * platform URL (PRD dashboard#738, slice S1). The active-sessions table
 * (S3/S4) layers onto this page once the SessionService RPC lands.
 */
export default async function CliSettingsPage() {
  const active = await readRawActiveTenant();

  if (active.status !== "present" || !active.tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect the CLI</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Select an active tenant to see the CLI commands for it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CliCommandsCard
        tenantSlug={active.tenantId}
        gibsonUrl={env.GIBSON_PUBLIC_URL}
      />
      <SessionsTable />
    </div>
  );
}
