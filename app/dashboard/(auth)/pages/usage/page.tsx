import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { UsageContent } from "@/components/gibson/usage/UsageContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Usage — LLM cost & tokens",
    additionalTitle: true,
    description:
      "Cost and token rollups across users, teams, agents, and missions.",
    canonical: "/pages/usage",
  });
}

/**
 * /dashboard/pages/usage — LLM usage rollups for the tenant.
 *
 * Spec: llm-user-attribution-governance (Requirement 2).
 */
export default function UsagePage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string; scope?: string };
}) {
  return (
    <UsageContent
      fromParam={searchParams?.from}
      toParam={searchParams?.to}
      scopeParam={searchParams?.scope}
    />
  );
}
