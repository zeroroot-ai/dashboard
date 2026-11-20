// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { generateMeta } from "@/lib/utils";

import { IncidentReport } from "@/components/gibson/incidents/IncidentReport";

/**
 * Incident report page. GetIncidentReport needs the "member" relation, so each
 * signed-in member of the workspace may open it. The graph page links here from
 * an Incident node.
 */

interface PageProps {
  params: Promise<{ key: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Incident report",
    description: "An incident with its alerts, its response actions, its cause and the proof of its fix.",
    canonical: "/incidents",
  });
}

export default async function IncidentReportPage({ params }: PageProps) {
  const { key } = await params;
  return <IncidentReport incidentKey={decodeURIComponent(key)} />;
}
