/**
 * <AgentConfigEditor />, form for AgentNodeConfig.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AgentNodeConfig } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface AgentConfigEditorProps {
  value: AgentNodeConfig | undefined;
  onChange: (next: AgentNodeConfig) => void;
}

const empty: AgentNodeConfig = {
  $typeName: "gibson.mission.v1.AgentNodeConfig" as const,
  agentName: "",
  task: undefined,
  maxTokensPerCall: undefined,
  llmSlots: [],
};

export function AgentConfigEditor({ value, onChange }: AgentConfigEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<AgentNodeConfig>) =>
    onChange({ ...config, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="agent-name">Agent name</Label>
        <Input
          id="agent-name"
          value={config.agentName}
          onChange={(e) => update({ agentName: e.target.value })}
          placeholder="e.g. nmap-agent"
          className="font-mono text-sm"
        />
      </div>
      <div>
        <Label htmlFor="agent-max-tokens-per-call">
          Max tokens per call (override)
        </Label>
        <p className="text-xs text-muted-foreground mb-1">
          Overrides the mission-level cap for this node only. Leave
          empty to inherit from MissionConstraints.
        </p>
        <Input
          id="agent-max-tokens-per-call"
          type="number"
          min={0}
          value={config.maxTokensPerCall ?? ""}
          onChange={(e) =>
            update({
              maxTokensPerCall:
                e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
          placeholder="(inherit)"
        />
      </div>
    </div>
  );
}
