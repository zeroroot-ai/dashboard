import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { ProvidersContent } from "@/components/gibson/settings/ProvidersContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings | Providers",
    additionalTitle: true,
    description: "Configure LLM provider credentials and model defaults for Gibson agents.",
    canonical: "/pages/settings/providers",
  });
}

export default function ProvidersPage() {
  return <ProvidersContent />;
}
