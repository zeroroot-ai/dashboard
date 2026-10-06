// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { AuditLogContent } from "@/components/gibson/audit-log/AuditLogContent";
import { AUDIT_TEXT } from "@/components/gibson/audit-log/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";

/**
 * Audit log page, server component (lane 11 row G23).
 *
 * ListAuditEvents carries the "admin" relation on the tenant, so only the
 * Owner and the Admin may open the page. Any other role that opens the
 * address goes back to the dashboard home. The daemon checks the relation
 * again on each call.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: AUDIT_TEXT.title,
    description: AUDIT_TEXT.intro,
    canonical: "/organization/audit-log",
  });
}

export default async function AuditLogPage() {
  try {
    await assertAuthorized("/gibson.tenant.v1.TenantService/ListAuditEvents");
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  return <AuditLogContent />;
}
