import { PluginsContent } from "@/components/gibson/settings/PluginsContent";
import { DeployLauncher } from "@/components/gibson/deploy";
import { docsUrl } from "@/src/lib/docs-url";

export function generateMetadata() {
  return { title: "Plugins - Zero Root AI" };
}

export default function PluginsPage() {
  return (
    <div className="space-y-4">
      <DeployLauncher type="plugin" />
      {/* Computed server-side: docsUrl reads the chart-provided DOCS_URL,
          which a client component cannot (dashboard#1036). */}
      <PluginsContent docsHref={docsUrl("plugins")} />
    </div>
  );
}
