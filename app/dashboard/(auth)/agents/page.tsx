// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { AgentsContent } from "@/components/gibson/agents/AgentsContent";
import { DeployLauncher } from "@/components/gibson/deploy";

export default function AgentsPage() {
  return (
    <div className="space-y-4">
      <DeployLauncher type="agent" />
      <AgentsContent />
    </div>
  );
}
