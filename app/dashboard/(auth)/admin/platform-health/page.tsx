// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { getPlatformHealthAction } from "@/app/actions/platform-health";
import { PlatformHealthContent } from "@/components/gibson/platform-health/PlatformHealthContent";
import { PLATFORM_HEALTH_TEXTS } from "@/components/gibson/platform-health/texts";

/**
 * The platform health page of the Platform owner (hosted#174). The RPC
 * carries the platform_owner relation on the system tenant. ext-authz
 * decides, and a caller without the relation goes back to the dashboard
 * home, the same denial every admin page gives.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: PLATFORM_HEALTH_TEXTS.title,
    description: PLATFORM_HEALTH_TEXTS.intro,
    canonical: "/admin/platform-health",
  });
}

export default async function PlatformHealthPage() {
  const first = await getPlatformHealthAction();
  if (!first.ok && first.code === "denied") {
    redirect("/dashboard");
  }
  return <PlatformHealthContent />;
}
