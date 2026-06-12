/**
 * <StepConfigSwitcher />, dispatches on the MissionNode.config
 * oneof discriminator and renders the matching per-noun
 * config editor.
 *
 * Bound to the generated MissionNode type's config oneof; the
 * switcher reads `node.config.case` ("agentConfig", "toolConfig",
 * etc.) to pick the editor.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import type { MissionNode } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

import { AgentConfigEditor } from "./agent-config-editor";
import { ToolConfigEditor } from "./tool-config-editor";
import { PluginConfigEditor } from "./plugin-config-editor";
import { ConditionConfigEditor } from "./condition-config-editor";
import { ParallelConfigEditor } from "./parallel-config-editor";
import { JoinConfigEditor } from "./join-config-editor";

interface StepConfigSwitcherProps {
  /** The full MissionNode being edited. */
  node: MissionNode;
  /** Setter for the whole node, config oneof + sibling fields. */
  onChange: (next: MissionNode) => void;
  /** Sibling node IDs the editor surfaces in pickers. */
  availableNodeIds: string[];
}

export function StepConfigSwitcher({
  node,
  onChange,
  availableNodeIds,
}: StepConfigSwitcherProps) {
  const cfg = node.config;
  if (!cfg) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Select a node type to configure this step.
      </p>
    );
  }

  switch (cfg.case) {
    case "agentConfig":
      return (
        <AgentConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({
              ...node,
              config: { case: "agentConfig", value },
            })
          }
        />
      );
    case "toolConfig":
      return (
        <ToolConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({ ...node, config: { case: "toolConfig", value } })
          }
        />
      );
    case "pluginConfig":
      return (
        <PluginConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({ ...node, config: { case: "pluginConfig", value } })
          }
        />
      );
    case "conditionConfig":
      return (
        <ConditionConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({
              ...node,
              config: { case: "conditionConfig", value },
            })
          }
          availableNodeIds={availableNodeIds}
        />
      );
    case "parallelConfig":
      return (
        <ParallelConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({
              ...node,
              config: { case: "parallelConfig", value },
            })
          }
        />
      );
    case "joinConfig":
      return (
        <JoinConfigEditor
          value={cfg.value}
          onChange={(value) =>
            onChange({ ...node, config: { case: "joinConfig", value } })
          }
          availableNodeIds={availableNodeIds}
        />
      );
    default:
      return (
        <p className="text-sm text-destructive">
          Unknown node config type. This is a bug; please refresh
          the dashboard or report the offending step.
        </p>
      );
  }
}
