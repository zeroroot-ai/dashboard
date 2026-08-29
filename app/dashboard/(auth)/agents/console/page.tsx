import { AgentConsole } from "@/components/gibson/agent-console/AgentConsole";
import { generateMeta } from "@/lib/utils";

export function generateMetadata() {
  return generateMeta({
    title: "Coding Agent Console",
    description: "Read-only live view of your tenant's running agents",
    canonical: "/agents/console",
  });
}

export default function AgentConsolePage() {
  return (
    <div className="space-y-4">
      <AgentConsole />
    </div>
  );
}
