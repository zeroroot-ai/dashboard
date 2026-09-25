// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";

import { generateMeta } from "@/lib/utils";
import { env } from "@/src/lib/env-validator";
import { auth } from "@/auth";
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
    title: "Settings | CLI",
    additionalTitle: true,
    description:
      "Connect the gibson CLI to this tenant: copy-pasteable login and component check-in commands.",
    canonical: "/pages/settings/cli",
  });
}

/**
 * /dashboard/pages/settings/cli, every member. Renders the CLI
 * command-reference card pre-filled with this tenant's slug and the public
 * platform URL (PRD dashboard#738, slice S1). The active-sessions table
 * (S3/S4) layers onto this page once the SessionService RPC lands.
 */
export default async function CliSettingsPage() {
  const session = await auth();
  const tenantId = session?.tenantId;

  if (!tenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect the CLI</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Your account has no tenant yet, so there are no CLI commands to show.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CliCommandsCard
        tenantSlug={tenantId}
        gibsonUrl={env.GIBSON_PUBLIC_URL}
      />
      <SessionsTable />
    </div>
  );
}
