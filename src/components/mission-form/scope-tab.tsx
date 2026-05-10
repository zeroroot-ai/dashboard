/**
 * <ScopeTab /> — controlled form for the mission's identifying
 * fields. Rebinds to the canonical proto MissionDefinition
 * type (replaces the pre-rewrite hand-written shape).
 *
 * Fields:
 *   name         — kebab-case identifier; CI / template gate
 *                  may enforce a stricter pattern.
 *   description  — free-form description.
 *   version      — semver string.
 *   target_ref   — name or ID of the target this mission runs
 *                  against. Resolved server-side at submit.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 5.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { MissionDefinition } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface ScopeTabProps {
  /** The full MissionDefinition; updates land via onChange. */
  value: MissionDefinition;
  onChange: (next: MissionDefinition) => void;
}

export function ScopeTab({ value, onChange }: ScopeTabProps) {
  const update = (patch: Partial<MissionDefinition>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="mission-name">Name</Label>
        <p className="text-xs text-muted-foreground mb-1">
          Identifier for this mission. Use kebab-case
          (e.g. <code className="font-mono">recon-prod-web</code>).
        </p>
        <Input
          id="mission-name"
          value={value.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="my-mission"
          className="font-mono text-sm"
        />
      </div>
      <div>
        <Label htmlFor="mission-description">Description</Label>
        <Textarea
          id="mission-description"
          value={value.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="What does this mission do?"
          rows={3}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="mission-version">Version</Label>
          <Input
            id="mission-version"
            value={value.version}
            onChange={(e) => update({ version: e.target.value })}
            placeholder="1.0.0"
            className="font-mono text-sm"
          />
        </div>
        <div>
          <Label htmlFor="mission-target-ref">Target</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Name or ID of a registered target.
          </p>
          <Input
            id="mission-target-ref"
            value={value.targetRef}
            onChange={(e) => update({ targetRef: e.target.value })}
            placeholder="target-name-or-id"
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}
