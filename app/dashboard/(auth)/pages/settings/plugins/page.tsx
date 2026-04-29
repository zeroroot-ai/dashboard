import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { PluginsContent } from "@/components/gibson/settings/PluginsContent";
import { PluginsPageHeader } from "@/src/components/gibson/settings/PluginsPageHeader";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Plugins",
    additionalTitle: true,
    description: "Enable, disable, and configure Gibson plugin integrations.",
    canonical: "/pages/settings/plugins",
  });
}

export default function PluginsPage() {
  return (
    <div className="space-y-4">
      {/* Header with "Add Plugin" wizard launcher — Task 15 extension */}
      <PluginsPageHeader />
      {/* Existing plugin catalog matrix — template, do not modify */}
      <PluginsContent />
    </div>
  );
}
