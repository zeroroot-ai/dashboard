/**
 * <JoinConfigEditor />, form surface for the JOIN node config.
 *
 * Binds to the generated `JoinNodeConfig` proto type:
 *   wait_for[]   , multi-select from sibling node IDs.
 *   strategy     , Select for MergeStrategy enum.
 *   aggregator   , CEL expression, conditionally visible when
 *                   strategy is MERGE_STRATEGY_CUSTOM.
 *
 * Inline validation surfaces in the controlled
 * `validationMessages` prop, non-empty wait_for is required,
 * non-empty aggregator is required when strategy is CUSTOM.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 7.
 */

"use client";

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  MergeStrategy,
  type JoinNodeConfig,
} from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface ValidationMessage {
  fieldPath: string;
  severity: "error" | "warning";
  message: string;
}

interface JoinConfigEditorProps {
  /** Live JoinNodeConfig value (proto type). */
  value: JoinNodeConfig | undefined;
  /** Setter for the JoinNodeConfig. */
  onChange: (next: JoinNodeConfig) => void;
  /**
   * Sibling node IDs available as wait_for sources. The
   * orchestrator allows JOIN to wait on any node in the
   * mission DAG; the form filters to siblings the user can
   * actually reference.
   */
  availableNodeIds: string[];
  /** Path-keyed validation messages relative to this editor's root. */
  validationMessages?: ValidationMessage[];
}

const STRATEGY_OPTIONS: Array<{
  value: MergeStrategy;
  label: string;
  description: string;
}> = [
  {
    value: MergeStrategy.CONCAT,
    label: "Concat",
    description: "Order-preserving list of source results.",
  },
  {
    value: MergeStrategy.REDUCE,
    label: "Reduce",
    description: "Fold source metadata into one map (last-writer-wins).",
  },
  {
    value: MergeStrategy.FIRST,
    label: "First",
    description: "Return the first source's result.",
  },
  {
    value: MergeStrategy.LAST,
    label: "Last",
    description: "Return the last source's result.",
  },
  {
    value: MergeStrategy.CUSTOM,
    label: "Custom (CEL)",
    description: "Evaluate the aggregator CEL expression over `sources`.",
  },
];

export function JoinConfigEditor({
  value,
  onChange,
  availableNodeIds,
  validationMessages = [],
}: JoinConfigEditorProps) {
  // Default to CONCAT when no value is set; protovalidate
  // accepts either UNSPECIFIED or any concrete strategy.
  const config = useMemo<JoinNodeConfig>(
    () =>
      value ?? {
        $typeName: "gibson.mission.v1.JoinNodeConfig" as const,
        waitFor: [],
        strategy: MergeStrategy.CONCAT,
        aggregator: "",
      },
    [value],
  );

  const isCustom = config.strategy === MergeStrategy.CUSTOM;

  const errorFor = (path: string) =>
    validationMessages.find(
      (m) => m.fieldPath === path && m.severity === "error",
    )?.message;

  const update = (patch: Partial<JoinNodeConfig>) => {
    onChange({ ...config, ...patch });
  };

  const addWaitFor = (id: string) => {
    if (config.waitFor.includes(id)) return;
    update({ waitFor: [...config.waitFor, id] });
  };
  const removeWaitFor = (id: string) => {
    update({ waitFor: config.waitFor.filter((x) => x !== id) });
  };

  // Sources not yet selected; deduped against the current
  // wait_for so the picker doesn't offer already-selected IDs.
  const remaining = availableNodeIds.filter(
    (id) => !config.waitFor.includes(id),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Wait for (sources)</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Upstream node IDs that must complete before this JOIN runs.
          At least one is required.
        </p>
        <div className="flex flex-wrap gap-1 mb-2 min-h-7">
          {config.waitFor.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              none selected
            </span>
          ) : (
            config.waitFor.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1 pl-2 pr-1">
                <span className="font-mono text-xs">{id}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0"
                  onClick={() => removeWaitFor(id)}
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))
          )}
        </div>
        {remaining.length > 0 ? (
          <Select onValueChange={addWaitFor}>
            <SelectTrigger>
              <SelectValue placeholder="Add a source node…" />
            </SelectTrigger>
            <SelectContent>
              {remaining.map((id) => (
                <SelectItem key={id} value={id}>
                  <span className="font-mono">{id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            All available nodes selected.
          </p>
        )}
        {errorFor("wait_for") ? (
          <p className="mt-1 text-xs text-destructive">
            {errorFor("wait_for")}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="merge-strategy">Merge strategy</Label>
        <Select
          value={String(config.strategy)}
          onValueChange={(v) =>
            update({ strategy: Number(v) as MergeStrategy })
          }
        >
          <SelectTrigger id="merge-strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STRATEGY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                <div className="flex flex-col">
                  <span>{opt.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCustom ? (
        <div>
          <Label htmlFor="aggregator">Aggregator (CEL)</Label>
          <p className="text-xs text-muted-foreground mb-2">
            CEL expression evaluated against{" "}
            <code className="font-mono">sources</code> (a map of
            source node ID to its result). Required when strategy is
            Custom.
          </p>
          <Textarea
            id="aggregator"
            value={config.aggregator}
            onChange={(e) => update({ aggregator: e.target.value })}
            placeholder="e.g. sources.scan.findings_count + sources.enrich.findings_count"
            rows={3}
            className="font-mono text-sm"
          />
          {errorFor("aggregator") ? (
            <p className="mt-1 text-xs text-destructive">
              {errorFor("aggregator")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * validateJoinConfig, pure-function validator returning the
 * paths that violate constraints. Mirrors the daemon-side
 * protovalidate rules so the form gives author-time feedback.
 *
 * Returned ValidationMessage paths are relative to the
 * JoinConfigEditor's root, so callers prefix them when storing
 * into the form's mission-wide validation list.
 */
export function validateJoinConfig(
  cfg: JoinNodeConfig | undefined,
): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  if (!cfg) {
    out.push({
      fieldPath: "wait_for",
      severity: "error",
      message: "JOIN config is missing.",
    });
    return out;
  }
  if (cfg.waitFor.length === 0) {
    out.push({
      fieldPath: "wait_for",
      severity: "error",
      message: "wait_for must list at least one source node.",
    });
  }
  if (
    cfg.strategy === MergeStrategy.CUSTOM &&
    cfg.aggregator.trim() === ""
  ) {
    out.push({
      fieldPath: "aggregator",
      severity: "error",
      message: "Custom strategy requires a non-empty CEL aggregator.",
    });
  }
  return out;
}
