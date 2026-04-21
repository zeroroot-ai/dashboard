import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { ModelAccessContent } from "@/components/gibson/model-access/ModelAccessContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Model access",
    additionalTitle: true,
    description:
      "Control which users and teams can use which LLM providers and models. Grant absent → permit-all (backwards compatible).",
    canonical: "/pages/settings/model-access",
  });
}

/**
 * /dashboard/pages/settings/model-access — admin-only. Matrix of
 * (subject × target) grants, bulk controls, and the last 30 days of
 * model_resolved audit events.
 *
 * Spec: llm-user-attribution-governance (Requirement 4).
 */
export default function ModelAccessPage() {
  return <ModelAccessContent />;
}
