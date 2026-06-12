/**
 * <ParallelConfigEditor />, form for ParallelNodeConfig.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ParallelNodeConfig } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface ParallelConfigEditorProps {
  value: ParallelNodeConfig | undefined;
  onChange: (next: ParallelNodeConfig) => void;
}

const empty: ParallelNodeConfig = {
  $typeName: "gibson.mission.v1.ParallelNodeConfig" as const,
  subNodes: [],
  maxConcurrency: 0,
};

export function ParallelConfigEditor({
  value,
  onChange,
}: ParallelConfigEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<ParallelNodeConfig>) =>
    onChange({ ...config, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="parallel-max-concurrency">Max concurrency</Label>
        <p className="text-xs text-muted-foreground mb-1">
          Cap on simultaneous sub-node execution. 0 means inherit
          the orchestrator&rsquo;s global cap (10).
        </p>
        <Input
          id="parallel-max-concurrency"
          type="number"
          min={0}
          value={config.maxConcurrency}
          onChange={(e) =>
            update({ maxConcurrency: Number(e.target.value) })
          }
          placeholder="0 (inherit)"
        />
      </div>
      <div>
        <Label>Sub-nodes</Label>
        <p className="text-xs text-muted-foreground">
          {config.subNodes.length} sub-node
          {config.subNodes.length === 1 ? "" : "s"} configured.
          Edit sub-nodes from the parent step list, each
          sub-node is itself a full MissionNode and has its own
          card in the steps tab.
        </p>
      </div>
    </div>
  );
}
