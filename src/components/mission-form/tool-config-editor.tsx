/**
 * <ToolConfigEditor /> — form for ToolNodeConfig.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

import type { ToolNodeConfig } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface ToolConfigEditorProps {
  value: ToolNodeConfig | undefined;
  onChange: (next: ToolNodeConfig) => void;
}

const empty: ToolNodeConfig = {
  $typeName: "gibson.mission.v1.ToolNodeConfig" as const,
  toolName: "",
  input: {},
  maxTokensPerCall: undefined,
};

export function ToolConfigEditor({ value, onChange }: ToolConfigEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<ToolNodeConfig>) =>
    onChange({ ...config, ...patch });

  const setInput = (key: string, val: string) => {
    update({ input: { ...config.input, [key]: val } });
  };
  const removeInput = (key: string) => {
    const next = { ...config.input };
    delete next[key];
    update({ input: next });
  };
  const addInput = () => {
    let i = 1;
    while (config.input[`key${i}`] !== undefined) i++;
    setInput(`key${i}`, "");
  };

  const inputEntries = Object.entries(config.input);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="tool-name">Tool name</Label>
        <Input
          id="tool-name"
          value={config.toolName}
          onChange={(e) => update({ toolName: e.target.value })}
          placeholder="e.g. nmap"
          className="font-mono text-sm"
        />
      </div>

      <div>
        <Label>Input parameters</Label>
        <p className="text-xs text-muted-foreground mb-2">
          String key-value pairs passed to the tool. Tool-specific
          schemas dictate what the tool accepts.
        </p>
        <div className="flex flex-col gap-2">
          {inputEntries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <Input
                value={k}
                onChange={(e) => {
                  const newKey = e.target.value;
                  const next = { ...config.input };
                  delete next[k];
                  next[newKey] = v;
                  update({ input: next });
                }}
                placeholder="key"
                className="flex-1 font-mono text-sm"
              />
              <Input
                value={v}
                onChange={(e) => setInput(k, e.target.value)}
                placeholder="value"
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeInput(k)}
                aria-label={`Remove ${k}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addInput}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add input
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="tool-max-tokens-per-call">
          Max tokens per call (override)
        </Label>
        <p className="text-xs text-muted-foreground mb-1">
          Applies if this tool spawns LLM calls.
        </p>
        <Input
          id="tool-max-tokens-per-call"
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
