// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { OutsideAgentDetail } from "@/components/gibson/outside-agents/OutsideAgentDetail";
import { OUTSIDE_AGENT_TEXT } from "@/components/gibson/outside-agents/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";
import { OUTSIDE_AGENT_PAGE_METHOD } from "@/src/lib/outside-agents/gate";

/** Outside agent detail page. The same "admin" gate as the list page. */

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
    title: `${OUTSIDE_AGENT_TEXT.title} | ${decodeName(name)}`,
    description: OUTSIDE_AGENT_TEXT.intro,
    canonical: `/outside-agents/${name}`,
  });
}

export default async function OutsideAgentDetailPage({ params }: PageProps) {
  try {
    await assertAuthorized(OUTSIDE_AGENT_PAGE_METHOD);
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  const { name } = await params;
  return <OutsideAgentDetail name={decodeName(name)} />;
}
