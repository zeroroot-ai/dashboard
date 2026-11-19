// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { FindingDetail } from "@/components/gibson/findings/FindingDetail";

/**
 * Finding detail page. GetFinding needs the "member" relation, so each
 * signed-in member of the workspace may open it. The page loads the finding
 * with all its evidence.
 */

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Finding",
    description: "A finding with all its evidence.",
    canonical: "/findings",
  });
}

export default async function FindingDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <FindingDetail id={id} />;
}
