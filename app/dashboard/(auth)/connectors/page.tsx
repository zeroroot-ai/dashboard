import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { ConnectorsContent } from "@/components/gibson/settings/ConnectorsContent";
import { docsUrl } from "@/src/lib/docs-url";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Connectors",
    description: "Enable third-party connectors and give your agents their tools.",
    canonical: "/connectors",
  });
}

export default function ConnectorsPage() {
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  return <ConnectorsContent docsHref={docsUrl("connectors")} />;
}
