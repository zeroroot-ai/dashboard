// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { OntologyProposalsContent } from "@/components/gibson/ontology-proposals/OntologyProposalsContent";
import { ONTOLOGY_TEXT } from "@/components/gibson/ontology-proposals/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";

/**
 * Ontology proposal page, server component (dashboard#191, gibson#618).
 *
 * The list RPC carries the "admin" relation on the tenant, so the Owner and
 * the Admin may open the page. The decisions carry "owner": the page shows
 * them to the Owner only. Any other role that opens the address goes back to
 * the dashboard home. The daemon checks each relation again.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: ONTOLOGY_TEXT.title,
    description: ONTOLOGY_TEXT.intro,
    canonical: "/organization/ontology-proposals",
  });
}

export default async function OntologyProposalsPage() {
  try {
    await assertAuthorized(
      "/gibson.tenant.v1.OntologyExtensionService/ListOntologyExtensionProposals",
    );
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  return <OntologyProposalsContent />;
}
