/**
 * <ConditionConfigEditor /> — form for ConditionNodeConfig.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

import {
  Language,
  type ConditionNodeConfig,
} from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface ConditionConfigEditorProps {
  value: ConditionNodeConfig | undefined;
  onChange: (next: ConditionNodeConfig) => void;
  /** Sibling node IDs available as branch targets. */
  availableNodeIds: string[];
}

const empty: ConditionNodeConfig = {
  $typeName: "gibson.mission.v1.ConditionNodeConfig" as const,
  expression: "",
  trueBranch: [],
  falseBranch: [],
  language: Language.UNSPECIFIED,
};

export function ConditionConfigEditor({
  value,
  onChange,
  availableNodeIds,
}: ConditionConfigEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<ConditionNodeConfig>) =>
    onChange({ ...config, ...patch });

  const Branch = ({
    label,
    field,
  }: {
    label: string;
    field: "trueBranch" | "falseBranch";
  }) => {
    const ids = config[field];
    const remaining = availableNodeIds.filter((id) => !ids.includes(id));
    return (
      <div>
        <Label>{label}</Label>
        <div className="flex flex-wrap gap-1 mb-2 min-h-7">
          {ids.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              none
            </span>
          ) : (
            ids.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1 pl-2 pr-1">
                <span className="font-mono text-xs">{id}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0"
                  onClick={() =>
                    update({ [field]: ids.filter((x) => x !== id) } as Partial<ConditionNodeConfig>)
                  }
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))
          )}
        </div>
        {remaining.length > 0 ? (
          <Select
            onValueChange={(id) =>
              update({ [field]: [...ids, id] } as Partial<ConditionNodeConfig>)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Add a branch target…" />
            </SelectTrigger>
            <SelectContent>
              {remaining.map((id) => (
                <SelectItem key={id} value={id}>
                  <span className="font-mono">{id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="condition-expression">CEL expression</Label>
        <p className="text-xs text-muted-foreground mb-1">
          Evaluated against{" "}
          <code className="font-mono">nodes</code>,{" "}
          <code className="font-mono">mission</code>, and{" "}
          <code className="font-mono">constraints</code>. Must
          return a boolean.
        </p>
        <Textarea
          id="condition-expression"
          value={config.expression}
          onChange={(e) => update({ expression: e.target.value })}
          placeholder="nodes.scan.findings_count > 0"
          rows={3}
          className="font-mono text-sm"
        />
      </div>

      <Branch label="True branch (node IDs)" field="trueBranch" />
      <Branch label="False branch (node IDs)" field="falseBranch" />
    </div>
  );
}
