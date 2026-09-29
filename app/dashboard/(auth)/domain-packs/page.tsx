// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { DomainPacksContent } from "@/components/gibson/settings/DomainPacksContent";
import { docsUrl } from "@/src/lib/docs-url";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Domain Packs",
    description: "Enable curated Domain Packs and give your agents their settlement predicates.",
    canonical: "/domain-packs",
  });
}

export default function DomainPacksPage() {
  // Computed server-side: docsUrl reads the chart-provided DOCS_URL, which a
  // client component cannot (dashboard#1036).
  return <DomainPacksContent docsHref={docsUrl("domain-packs")} />;
}
