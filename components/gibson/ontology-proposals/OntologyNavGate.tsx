// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * OntologyNavGate — renders the "Ontology proposals" menu entry only for the
 * Owner and the Admin, the roles that may read the proposals (dashboard#191).
 * It hides the entry while the answer is loading, so the entry never flashes
 * for a role that may not open the page.
 */

import * as React from "react";

import { useAuthorize } from "@/src/lib/auth/use-authorize";

const LIST_METHOD = "/gibson.tenant.v1.OntologyExtensionService/ListOntologyExtensionProposals";

export function OntologyNavGate({ children }: { children: React.ReactNode }) {
  const { allowed, loading } = useAuthorize(LIST_METHOD);
  if (loading || !allowed) return null;
  return <>{children}</>;
}
