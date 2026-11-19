// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { InboundMissionsContent } from "@/components/gibson/inbound-missions/InboundMissionsContent";
import { INBOUND_MISSION_TEXT } from "@/components/gibson/inbound-missions/texts";
import { assertAuthorized, authzDenial } from "@/src/lib/auth/assert-authorized";
import { INBOUND_MISSION_PAGE_METHOD } from "@/src/lib/inbound-missions/gate";

/**
 * Inbound missions page, server component (epic gibson#1367, gibson#1408).
 * Each InboundMissionService RPC carries the "admin" relation on the tenant,
 * so only the Owner and the Admin may open the page. Any other role goes back
 * to the dashboard home. The daemon checks the relation again on each call.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: INBOUND_MISSION_TEXT.title,
    description: INBOUND_MISSION_TEXT.intro,
    canonical: "/inbound-missions",
  });
}

export default async function InboundMissionsPage() {
  try {
    await assertAuthorized(INBOUND_MISSION_PAGE_METHOD);
  } catch (err) {
    if (authzDenial(err)) {
      redirect("/dashboard");
    }
    throw err;
  }
  return <InboundMissionsContent />;
}
