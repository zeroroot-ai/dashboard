import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { AgentsContent } from "@/components/gibson/settings/AgentsContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Agent Auth",
    additionalTitle: true,
    description:
      "Manage Agent Auth registrations and issue host registration tokens for Gibson autonomous agents.",
    canonical: "/pages/settings/agents",
  });
}

export default function AgentsPage() {
  return <AgentsContent />;
}
