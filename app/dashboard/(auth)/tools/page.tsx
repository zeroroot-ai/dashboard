// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { ToolsContent } from "@/components/gibson/tools/ToolsContent";
import { DeployLauncher } from "@/components/gibson/deploy";
import { generateMeta } from "@/lib/utils";

export function generateMetadata() {
  return generateMeta({ title: "Tools", description: "Registered security tools", canonical: "/tools" });
}

export default function ToolsPage() {
  return (
    <div className="space-y-4">
      <DeployLauncher type="tool" />
      <ToolsContent />
    </div>
  );
}
