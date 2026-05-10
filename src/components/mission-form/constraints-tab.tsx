/**
 * <ConstraintsTab /> — controlled form for the mission's
 * MissionConstraints proto. Replaces the pre-rewrite UI-only
 * guardrails shape; confirmationRequired[] is dropped per
 * design.md Component 10 (path b).
 *
 * Fields:
 *   max_duration_seconds   0 = no limit
 *   max_findings           0 = no limit
 *   max_tokens             mission-total LLM budget; 0 = unlimited
 *   max_tokens_per_call    per-call cap, cascades to nodes that
 *                          don't override; 0 = unlimited
 *   max_turns_per_agent    0 = no limit
 *   allowed_techniques     repeated MITRE technique IDs
 *   blocked_techniques     repeated MITRE technique IDs
 *
 * Spec: mission-dashboard-rewrite Requirement 2 + Task 9.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { MissionConstraints } from "@/src/gen/gibson/daemon/v1/daemon_pb";

interface ConstraintsTabProps {
  value: MissionConstraints;
  onChange: (next: MissionConstraints) => void;
}

export function ConstraintsTab({ value, onChange }: ConstraintsTabProps) {
  const update = (patch: Partial<MissionConstraints>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="constraints-max-duration">
            Max duration (seconds)
          </Label>
          <p className="text-xs text-muted-foreground mb-1">0 = no limit.</p>
          <Input
            id="constraints-max-duration"
            type="number"
            min={0}
            value={value.maxDurationSeconds}
            onChange={(e) =>
              update({ maxDurationSeconds: Number(e.target.value) })
            }
          />
        </div>
        <div>
          <Label htmlFor="constraints-max-findings">Max findings</Label>
          <p className="text-xs text-muted-foreground mb-1">0 = no limit.</p>
          <Input
            id="constraints-max-findings"
            type="number"
            min={0}
            value={value.maxFindings}
            onChange={(e) => update({ maxFindings: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="constraints-max-tokens">Mission token budget</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Total LLM tokens across the mission. 0 = unlimited.
          </p>
          <Input
            id="constraints-max-tokens"
            type="number"
            min={0}
            value={value.maxTokens}
            onChange={(e) => update({ maxTokens: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="constraints-max-tokens-per-call">
            Per-call token cap
          </Label>
          <p className="text-xs text-muted-foreground mb-1">
            Default per-LLM-call cap. Per-node configs can override.
            0 = unlimited.
          </p>
          <Input
            id="constraints-max-tokens-per-call"
            type="number"
            min={0}
            value={value.maxTokensPerCall}
            onChange={(e) =>
              update({ maxTokensPerCall: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div>
        <Label htmlFor="constraints-max-turns">Max turns per agent</Label>
        <p className="text-xs text-muted-foreground mb-1">0 = no limit.</p>
        <Input
          id="constraints-max-turns"
          type="number"
          min={0}
          value={value.maxTurnsPerAgent}
          onChange={(e) =>
            update({ maxTurnsPerAgent: Number(e.target.value) })
          }
        />
      </div>

      <div>
        <Label htmlFor="constraints-allowed-techniques">
          Allowed MITRE techniques
        </Label>
        <p className="text-xs text-muted-foreground mb-1">
          Comma- or newline-separated. Empty list = all allowed.
        </p>
        <Textarea
          id="constraints-allowed-techniques"
          value={value.allowedTechniques.join("\n")}
          onChange={(e) =>
            update({
              allowedTechniques: parseTechniqueList(e.target.value),
            })
          }
          rows={3}
          className="font-mono text-sm"
          placeholder="T1078, T1190"
        />
      </div>

      <div>
        <Label htmlFor="constraints-blocked-techniques">
          Blocked MITRE techniques
        </Label>
        <p className="text-xs text-muted-foreground mb-1">
          Comma- or newline-separated. Empty list = none blocked.
        </p>
        <Textarea
          id="constraints-blocked-techniques"
          value={value.blockedTechniques.join("\n")}
          onChange={(e) =>
            update({
              blockedTechniques: parseTechniqueList(e.target.value),
            })
          }
          rows={3}
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}

function parseTechniqueList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
