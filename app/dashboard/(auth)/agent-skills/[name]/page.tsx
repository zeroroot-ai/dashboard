// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { AgentSkillDetail } from "@/components/gibson/agent-skills/AgentSkillDetail";
import { AGENT_SKILL_TEXT } from "@/components/gibson/agent-skills/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";
import { AGENT_SKILL_PAGE_METHOD } from "@/src/lib/agent-skills/gate";

/** Agent Skill detail page. The same "admin" gate as the list page. */

interface PageProps {
  params: Promise<{ name: string }>;
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { name } = await params;
  return generateMeta({
    title: `${AGENT_SKILL_TEXT.title} | ${decodeName(name)}`,
    description: AGENT_SKILL_TEXT.intro,
    canonical: `/agent-skills/${name}`,
  });
}

export default async function AgentSkillDetailPage({ params }: PageProps) {
  try {
    await assertAuthorized(AGENT_SKILL_PAGE_METHOD);
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  const { name } = await params;
  return <AgentSkillDetail name={decodeName(name)} />;
}
