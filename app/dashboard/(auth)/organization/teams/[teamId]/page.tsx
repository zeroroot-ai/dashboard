// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { TeamDetailContent } from "@/components/gibson/organization/TeamDetailContent";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  return (
    <div className="p-6">
      <TeamDetailContent teamId={decodeURIComponent(teamId)} />
    </div>
  );
}
