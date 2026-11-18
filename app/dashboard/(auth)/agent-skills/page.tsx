// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { AgentSkillsContent } from "@/components/gibson/agent-skills/AgentSkillsContent";
import { AGENT_SKILL_TEXT } from "@/components/gibson/agent-skills/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";
import { AGENT_SKILL_PAGE_METHOD } from "@/src/lib/agent-skills/gate";

/**
 * Agent Skills list page, server component (epic gibson#1364).
 *
 * Each AgentSkillService RPC carries the "admin" relation on the tenant, so
 * only the Owner and the Admin may open the page. Any other role that opens
 * the address goes back to the dashboard home. The daemon checks the relation
 * again on each call.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: AGENT_SKILL_TEXT.title,
    description: AGENT_SKILL_TEXT.intro,
    canonical: "/agent-skills",
  });
}

export default async function AgentSkillsPage() {
  try {
    await assertAuthorized(AGENT_SKILL_PAGE_METHOD);
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  return <AgentSkillsContent />;
}
