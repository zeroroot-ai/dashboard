import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { BillingContent } from "@/components/gibson/settings/BillingContent";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings | Billing",
    additionalTitle: true,
    description: "View your Gibson Enterprise plan, usage metrics, and manage your subscription.",
    canonical: "/pages/settings/billing",
  });
}

export default function BillingPage() {
  return <BillingContent />;
}
