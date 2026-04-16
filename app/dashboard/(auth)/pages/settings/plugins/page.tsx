import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { PluginsContent } from "@/components/gibson/settings/PluginsContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Plugins",
    additionalTitle: true,
    description: "Enable, disable, and configure Gibson plugin integrations.",
    canonical: "/pages/settings/plugins",
  });
}

export default function PluginsPage() {
  return <PluginsContent />;
}
