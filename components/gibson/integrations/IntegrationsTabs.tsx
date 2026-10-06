// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The one Integrations page (ADR-0065, dashboard#86): plugins and connectors
 * are two tabs of one page. The active tab is in the `tab` query parameter,
 * so a link or a bookmark opens the right tab, and the old routes
 * /dashboard/plugins and /dashboard/connectors redirect to it.
 */

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INTEGRATIONS_TEXTS as T } from "./texts";

export type IntegrationsTab = "plugins" | "connectors";

export function IntegrationsTabs({
  active,
  plugins,
  connectors,
}: {
  active: IntegrationsTab;
  plugins: React.ReactNode;
  connectors: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = React.useState<IntegrationsTab>(active);

  const change = (value: string) => {
    const next: IntegrationsTab = value === "connectors" ? "connectors" : "plugins";
    setTab(next);
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{T.heading}</h1>
      <Tabs value={tab} onValueChange={change}>
        <TabsList>
          <TabsTrigger value="plugins">{T.pluginsTab}</TabsTrigger>
          <TabsTrigger value="connectors">{T.connectorsTab}</TabsTrigger>
        </TabsList>
        <TabsContent value="plugins">{plugins}</TabsContent>
        <TabsContent value="connectors">{connectors}</TabsContent>
      </Tabs>
    </div>
  );
}
