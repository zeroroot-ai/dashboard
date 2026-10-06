// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * ComplianceNavGate — renders the "Compliance" menu entry only for the
 * Owner and the Admin, and only when the tenant enabled a compliance pack
 * (D56). It hides the entry while either answer is loading, so the entry
 * never flashes for a role that may not open the page.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { listCompliancePacksAction } from "@/app/actions/compliance";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

const COMPLIANCE_METHOD = "/gibson.tenant.v1.ComplianceService/ListComplianceEvidence";

export function ComplianceNavGate({ children }: { children: React.ReactNode }) {
  const { allowed, loading } = useAuthorize(COMPLIANCE_METHOD);
  const packs = useQuery({
    queryKey: ["compliance-packs"],
    queryFn: () => listCompliancePacksAction(),
    enabled: !loading && allowed,
    staleTime: 60_000,
  });
  if (loading || !allowed) return null;
  if (!packs.data?.ok || packs.data.data.length === 0) return null;
  return <>{children}</>;
}
