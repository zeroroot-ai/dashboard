import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { BudgetsContent } from "@/components/gibson/budgets/BudgetsContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings | Budgets",
    additionalTitle: true,
    description:
      "Per-user and per-team token and spend budgets. Admin-only configuration; exceeding a budget denies the next LLM call with a typed error.",
    canonical: "/pages/settings/budgets",
  });
}

/**
 * /dashboard/pages/settings/budgets, admin-only budget configuration.
 * Non-admins hitting this route see a read-only fallback (or redirect,
 * applied by the shared settings layout).
 *
 * Spec: llm-user-attribution-governance (Requirement 3).
 */
export default function BudgetsPage() {
  return <BudgetsContent />;
}
