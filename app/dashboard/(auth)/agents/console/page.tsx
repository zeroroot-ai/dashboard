import { Suspense } from "react";
import { AgentConsole } from "@/components/gibson/agent-console/AgentConsole";
import { generateMeta } from "@/lib/utils";

export function generateMetadata() {
  return generateMeta({
    title: "Agent Sandboxes",
    description: "Live, read-only view of the agents running in your tenant's sandboxes",
    canonical: "/agents/console",
  });
}

export default function AgentConsolePage() {
  return (
    <div className="space-y-4">
      {/* useSearchParams (the ?run= deep link) needs a Suspense boundary. */}
      <Suspense>
        <AgentConsole />
      </Suspense>
    </div>
  );
}
