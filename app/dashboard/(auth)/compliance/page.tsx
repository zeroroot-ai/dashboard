// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { ErrorAlert } from "@/components/gibson/shared";
import { ComplianceEvidenceContent } from "@/components/gibson/compliance/ComplianceEvidenceContent";
import { COMPLIANCE_TEXT } from "@/components/gibson/compliance/texts";
import { daemonListCompliancePacks } from "@/src/lib/gibson-client/compliance";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";

/**
 * Compliance evidence page, server component (dashboard#224, ADR-0113, D56).
 *
 * The RPC carries the "admin" relation on the tenant, so only the Owner and
 * the Admin may open the page. Any other role that opens the address goes
 * back to the dashboard home, the same denial every admin page gives. The
 * daemon checks the relation again on each call.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: COMPLIANCE_TEXT.title,
    description: COMPLIANCE_TEXT.intro,
    canonical: "/compliance",
  });
}

export default async function CompliancePage() {
  try {
    await assertAuthorized("/gibson.tenant.v1.ComplianceService/ListComplianceEvidence");
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }

  let packs: string[] = [];
  try {
    packs = await daemonListCompliancePacks();
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    return (
      <ErrorAlert error={err instanceof Error ? err : { message: String(err) }} />
    );
  }

  return <ComplianceEvidenceContent packs={packs} />;
}
