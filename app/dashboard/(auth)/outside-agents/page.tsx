// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { OutsideAgentsContent } from "@/components/gibson/outside-agents/OutsideAgentsContent";
import { OUTSIDE_AGENT_TEXT } from "@/components/gibson/outside-agents/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";
import { OUTSIDE_AGENT_PAGE_METHOD } from "@/src/lib/outside-agents/gate";

/**
 * Outside agents list page, server component (gibson#1403). Each
 * OutsideAgentService RPC carries the "admin" relation on the tenant, so only
 * the Owner and the Admin may open the page. Any other role goes back to the
 * dashboard home. The daemon checks the relation again on each call.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: OUTSIDE_AGENT_TEXT.title,
    description: OUTSIDE_AGENT_TEXT.intro,
    canonical: "/outside-agents",
  });
}

export default async function OutsideAgentsPage() {
  try {
    await assertAuthorized(OUTSIDE_AGENT_PAGE_METHOD);
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  return <OutsideAgentsContent />;
}
