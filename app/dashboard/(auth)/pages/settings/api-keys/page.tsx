import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { APIKeysContent } from "@/components/gibson/settings/APIKeysContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — API Keys",
    additionalTitle: true,
    description: "Generate and revoke API keys for programmatic access to Gibson.",
    canonical: "/pages/settings/api-keys",
  });
}

export default function APIKeysPage() {
  return <APIKeysContent />;
}
