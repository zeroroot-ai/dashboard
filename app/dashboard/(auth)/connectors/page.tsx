import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { ConnectorsContent } from "@/components/gibson/settings/ConnectorsContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Connectors",
    description: "Enable third-party connectors and give your agents their tools.",
    canonical: "/connectors",
  });
}

export default function ConnectorsPage() {
  return <ConnectorsContent />;
}
