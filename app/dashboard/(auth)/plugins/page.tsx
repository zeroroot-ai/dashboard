import { PluginsContent } from "@/components/gibson/settings/PluginsContent";
import { DeployLauncher } from "@/components/gibson/deploy";
import { docsUrl } from "@/src/lib/docs-url";

export function generateMetadata() {
  return { title: "Plugins - Zero Root AI" };
}

export default function PluginsPage() {
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  const docsHref = docsUrl("plugins");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          New to plugins?{" "}
          {/* Docs are a separate deployable on their own host (dashboard#820),
              so this is a plain cross-origin anchor: next/link cannot route
              to it, and an RSC prefetch of a cross-origin URL dies on CORS
              (dashboard#963). */}
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            See the guide
          </a>
        </p>
        <DeployLauncher type="plugin" />
      </div>
      <PluginsContent docsHref={docsHref} />
    </div>
  );
}
