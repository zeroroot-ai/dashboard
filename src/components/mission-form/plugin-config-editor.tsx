/**
 * <PluginConfigEditor />, form for PluginNodeConfig.
 *
 * PLUGIN = multi-method provider keyed by plugin_name + method.
 * Distinct from TOOL: a plugin advertises several callable
 * methods behind one component identity.
 *
 * Spec: mission-dashboard-rewrite Requirement 1 AC 3 + Task 6.
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

import type { PluginNodeConfig } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

interface PluginConfigEditorProps {
  value: PluginNodeConfig | undefined;
  onChange: (next: PluginNodeConfig) => void;
}

const empty: PluginNodeConfig = {
  $typeName: "gibson.mission.v1.PluginNodeConfig" as const,
  pluginName: "",
  method: "",
  params: {},
  maxTokensPerCall: undefined,
};

export function PluginConfigEditor({
  value,
  onChange,
}: PluginConfigEditorProps) {
  const config = value ?? empty;
  const update = (patch: Partial<PluginNodeConfig>) =>
    onChange({ ...config, ...patch });

  const setParam = (key: string, val: string) => {
    update({ params: { ...config.params, [key]: val } });
  };
  const removeParam = (key: string) => {
    const next = { ...config.params };
    delete next[key];
    update({ params: next });
  };
  const addParam = () => {
    let i = 1;
    while (config.params[`param${i}`] !== undefined) i++;
    setParam(`param${i}`, "");
  };

  const paramEntries = Object.entries(config.params);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="plugin-name">Plugin name</Label>
          <Input
            id="plugin-name"
            value={config.pluginName}
            onChange={(e) => update({ pluginName: e.target.value })}
            placeholder="e.g. shodan"
            className="font-mono text-sm"
          />
        </div>
        <div>
          <Label htmlFor="plugin-method">Method</Label>
          <Input
            id="plugin-method"
            value={config.method}
            onChange={(e) => update({ method: e.target.value })}
            placeholder="e.g. host_lookup"
            className="font-mono text-sm"
          />
        </div>
      </div>

      <div>
        <Label>Method parameters</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Key-value pairs forwarded to the plugin method.
        </p>
        <div className="flex flex-col gap-2">
          {paramEntries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <Input
                value={k}
                onChange={(e) => {
                  const newKey = e.target.value;
                  const next = { ...config.params };
                  delete next[k];
                  next[newKey] = v;
                  update({ params: next });
                }}
                placeholder="key"
                className="flex-1 font-mono text-sm"
              />
              <Input
                value={v}
                onChange={(e) => setParam(k, e.target.value)}
                placeholder="value"
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeParam(k)}
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
            onClick={addParam}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add parameter
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="plugin-max-tokens-per-call">
          Max tokens per call (override)
        </Label>
        <Input
          id="plugin-max-tokens-per-call"
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
