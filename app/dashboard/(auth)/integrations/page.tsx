// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { ConnectorsContent } from "@/components/gibson/settings/ConnectorsContent";
import { PluginsContent } from "@/components/gibson/settings/PluginsContent";
import { DeployLauncher } from "@/components/gibson/deploy";
import { IntegrationsTabs } from "@/components/gibson/integrations/IntegrationsTabs";
import { INTEGRATIONS_TEXTS } from "@/components/gibson/integrations/texts";
import { docsUrl } from "@/src/lib/docs-url";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: INTEGRATIONS_TEXTS.heading,
    description: "Enable third-party connectors and give your agents their tools.",
    canonical: "/integrations",
  });
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  const pluginsDocs = docsUrl("plugins");
  return (
    <IntegrationsTabs
      active={tab === "connectors" ? "connectors" : "plugins"}
      plugins={
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              New to plugins?{" "}
              {/* Docs are a separate deployable on their own host (dashboard#820),
                  so this is a plain cross-origin anchor: next/link cannot route
                  to it, and an RSC prefetch of a cross-origin URL dies on CORS
                  (dashboard#963). */}
              <a
                href={pluginsDocs}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                See the guide
              </a>
            </p>
            <DeployLauncher type="plugin" />
          </div>
          <PluginsContent docsHref={pluginsDocs} />
        </div>
      }
      connectors={<ConnectorsContent docsHref={docsUrl("connectors")} />}
    />
  );
}
