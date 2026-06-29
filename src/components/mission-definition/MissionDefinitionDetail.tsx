"use client";

/**
 * MissionDefinitionDetail, renders every author-facing field from a
 * MissionDefinition proto (full structured view, M6, ADR 0004).
 *
 * All 12 MissionConstraints fields, WorkspaceConfig,
 * per-node retry/data/reuse policies, and the six oneof node-config
 * variants are surfaced with a consistent empty-state pattern when unset.
 *
 * Layout: three collapsible sections (Overview, Constraints, Workspace)
 * above the node list. Each node expands inline. No "raw YAML" tab;
 * the structured view is the only path.
 *
 * Closes #187 (M6, mission-author-experience epic).
 */

import * as React from "react";
import { Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

import type {
  MissionDefinitionJson,
  ConstraintsJson,
  WorkspaceConfigJson,
  MissionNodeJson,
  RetryPolicyJson,
  DataPolicyJson,
  ReusePolicyJson,
  AgentNodeConfigJson,
  ToolNodeConfigJson,
  PluginNodeConfigJson,
  ConditionNodeConfigJson,
  ParallelNodeConfigJson,
  JoinNodeConfigJson,
} from "@/src/hooks/useMissionDefinition";

// -------------------------------------------------------------------------
// Small display helpers
// -------------------------------------------------------------------------

/** Renders a dash when the value is absent, zero, or an empty string. */
function Unset({ label }: { label: string }) {
  return (
    <span
      className="text-muted-foreground italic text-sm"
      aria-label={`${label} not set`}
    >
      -
    </span>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <dt className="w-44 shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wide font-mono">
        {label}
      </dt>
      <dd className="text-sm font-mono break-all">{children}</dd>
    </div>
  );
}

function TagList({ items, label }: { items: string[] | undefined; label: string }) {
  if (!items || items.length === 0) return <Unset label={label} />;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="outline" className="font-mono text-xs">
          {item}
        </Badge>
      ))}
    </div>
  );
}

/** Format a proto duration string ("300s", "1.5s") into a human-readable form. */
function formatDuration(d: string | undefined): string {
  if (!d) return "";
  // Duration JSON is "Xs" where X is total seconds (may include decimal).
  const secs = parseFloat(d.replace(/s$/, ""));
  if (Number.isNaN(secs) || secs === 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s % 1 === 0 ? s : s.toFixed(1)}s`);
  return parts.join(" ");
}

function DurationField({ value, label }: { value: string | undefined; label: string }) {
  const text = formatDuration(value);
  if (!text) return <Unset label={label} />;
  return <span className="tabular-nums">{text}</span>;
}

function NumericField({
  value,
  label,
  suffix,
}: {
  value: number | string | undefined;
  label: string;
  suffix?: string;
}) {
  const n = value === undefined ? 0 : Number(value);
  if (n === 0) return <Unset label={label} />;
  return (
    <span className="tabular-nums">
      {n.toLocaleString()}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function BoolField({ value, label }: { value: boolean | undefined; label: string }) {
  if (value === undefined) return <Unset label={label} />;
  return <span>{value ? "Yes" : "No"}</span>;
}

function StringField({
  value,
  label,
}: {
  value: string | undefined;
  label: string;
}) {
  if (!value) return <Unset label={label} />;
  return <span>{value}</span>;
}

/** Copy-to-clipboard for CEL / code fields. */
function CodeBlock({ value, label }: { value: string | undefined; label: string }) {
  if (!value) return <Unset label={label} />;
  const copy = () => navigator.clipboard.writeText(value).catch(() => {});
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded bg-muted px-3 py-2 text-xs font-mono">
        {value}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 size-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={copy}
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}

// -------------------------------------------------------------------------
// Section: MissionConstraints (ADR 0004, all 12 fields)
// -------------------------------------------------------------------------

function ConstraintsSection({ c }: { c: ConstraintsJson | undefined }) {
  const [open, setOpen] = React.useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded py-2 text-sm font-semibold tracking-tight hover:text-primary focus-visible:outline-none"
        >
          Constraints
          <span className="text-xs text-muted-foreground">{open ? "collapse" : "expand"}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="pt-4">
            <dl>
              <FieldRow label="Max duration">
                <DurationField value={c?.maxDuration} label="max_duration" />
              </FieldRow>
              <FieldRow label="Max tokens">
                <NumericField value={c?.maxTokens} label="max_tokens" />
              </FieldRow>
              <FieldRow label="Max cost (USD)">
                {c?.maxCost ? (
                  <span className="tabular-nums">${c.maxCost.toFixed(4)}</span>
                ) : (
                  <Unset label="max_cost" />
                )}
              </FieldRow>
              <FieldRow label="Max findings">
                <NumericField value={c?.maxFindings} label="max_findings" />
              </FieldRow>
              <FieldRow label="Severity threshold">
                <StringField value={c?.severityThreshold} label="severity_threshold" />
              </FieldRow>
              <FieldRow label="Require evidence">
                <BoolField value={c?.requireEvidence} label="require_evidence" />
              </FieldRow>
              <FieldRow label="Max turns / agent">
                <NumericField value={c?.maxTurnsPerAgent} label="max_turns_per_agent" />
              </FieldRow>
              <FieldRow label="Max tokens / call">
                <NumericField value={c?.maxTokensPerCall} label="max_tokens_per_call" />
              </FieldRow>
              <FieldRow label="Blocked tools">
                <TagList items={c?.blockedTools} label="blocked_tools" />
              </FieldRow>
              <FieldRow label="Blocked domains">
                <TagList items={c?.blockedDomains} label="blocked_domains" />
              </FieldRow>
              <FieldRow label="Allowed techniques">
                <TagList items={c?.allowedTechniques} label="allowed_techniques" />
              </FieldRow>
              <FieldRow label="Blocked techniques">
                <TagList items={c?.blockedTechniques} label="blocked_techniques" />
              </FieldRow>
            </dl>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -------------------------------------------------------------------------
// Section: WorkspaceConfig
// -------------------------------------------------------------------------

function WorkspaceSection({ w }: { w: WorkspaceConfigJson | undefined }) {
  const [open, setOpen] = React.useState(false);
  const repos = w?.repositories ?? [];
  const s = w?.settings;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-label="Workspace section toggle"
          className="flex w-full items-center justify-between rounded py-2 text-sm font-semibold tracking-tight hover:text-primary focus-visible:outline-none"
        >
          Workspace
          <span className="text-xs text-muted-foreground">{open ? "collapse" : "expand"}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="pt-4 space-y-4">
            {/* Settings */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Settings
              </h4>
              <dl>
                <FieldRow label="Cleanup on complete">
                  <BoolField value={s?.cleanupOnComplete} label="cleanup_on_complete" />
                </FieldRow>
                <FieldRow label="Use worktrees">
                  <BoolField value={s?.useWorktrees} label="use_worktrees" />
                </FieldRow>
                <FieldRow label="LSP enabled">
                  <BoolField value={s?.lspEnabled} label="lsp_enabled" />
                </FieldRow>
                <FieldRow label="LSP timeout">
                  <DurationField value={s?.lspTimeout} label="lsp_timeout" />
                </FieldRow>
                <FieldRow label="Base directory">
                  <StringField value={s?.baseDirectory} label="base_directory" />
                </FieldRow>
              </dl>
            </div>

            {/* Repositories */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Repositories ({repos.length})
              </h4>
              {repos.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No repositories configured.</p>
              ) : (
                <div className="space-y-3">
                  {repos.map((repo, i) => (
                    <Card key={repo.name ?? i} className="border-dashed">
                      <CardHeader className="pb-1 pt-3">
                        <CardTitle className="text-sm font-mono">
                          {repo.name || <Unset label="name" />}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-3">
                        <dl>
                          <FieldRow label="URL">
                            <StringField value={repo.url} label="url" />
                          </FieldRow>
                          <FieldRow label="Branch">
                            <StringField value={repo.branch} label="branch" />
                          </FieldRow>
                          <FieldRow label="Credential">
                            <StringField value={repo.credentialName} label="credential_name" />
                          </FieldRow>
                          <FieldRow label="Shallow">
                            <BoolField value={repo.shallow} label="shallow" />
                          </FieldRow>
                          <FieldRow label="Depends on">
                            <TagList items={repo.dependsOn} label="depends_on" />
                          </FieldRow>
                        </dl>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -------------------------------------------------------------------------
// Per-node config variants
// -------------------------------------------------------------------------

function AgentConfigCard({ cfg }: { cfg: AgentNodeConfigJson }) {
  return (
    <dl>
      <FieldRow label="Agent">
        <StringField value={cfg.agentName} label="agent_name" />
      </FieldRow>
      <FieldRow label="Goal">
        <StringField value={cfg.task?.goal} label="goal" />
      </FieldRow>
      <FieldRow label="Context">
        <StringField value={cfg.task?.context} label="context" />
      </FieldRow>
      <FieldRow label="Max tokens / call">
        <NumericField value={cfg.maxTokensPerCall} label="max_tokens_per_call" />
      </FieldRow>
    </dl>
  );
}

function ToolConfigCard({ cfg }: { cfg: ToolNodeConfigJson }) {
  const inputs = Object.entries(cfg.input ?? {});
  return (
    <dl>
      <FieldRow label="Tool">
        <StringField value={cfg.toolName} label="tool_name" />
      </FieldRow>
      <FieldRow label="Max tokens / call">
        <NumericField value={cfg.maxTokensPerCall} label="max_tokens_per_call" />
      </FieldRow>
      <FieldRow label="Inputs">
        {inputs.length === 0 ? (
          <Unset label="input" />
        ) : (
          <div className="space-y-1">
            {inputs.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-xs font-mono">
                <span className="text-muted-foreground">{k}:</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
      </FieldRow>
    </dl>
  );
}

function PluginConfigCard({ cfg }: { cfg: PluginNodeConfigJson }) {
  const params = Object.entries(cfg.params ?? {});
  return (
    <dl>
      <FieldRow label="Plugin">
        <StringField value={cfg.pluginName} label="plugin_name" />
      </FieldRow>
      <FieldRow label="Method">
        <StringField value={cfg.method} label="method" />
      </FieldRow>
      <FieldRow label="Max tokens / call">
        <NumericField value={cfg.maxTokensPerCall} label="max_tokens_per_call" />
      </FieldRow>
      <FieldRow label="Params">
        {params.length === 0 ? (
          <Unset label="params" />
        ) : (
          <div className="space-y-1">
            {params.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-xs font-mono">
                <span className="text-muted-foreground">{k}:</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
      </FieldRow>
    </dl>
  );
}

function ConditionConfigCard({ cfg }: { cfg: ConditionNodeConfigJson }) {
  return (
    <dl>
      <FieldRow label="Language">
        <StringField value={cfg.language} label="language" />
      </FieldRow>
      <FieldRow label="Expression">
        <CodeBlock value={cfg.expression} label="expression" />
      </FieldRow>
      <FieldRow label="True branch">
        <TagList items={cfg.trueBranch} label="true_branch" />
      </FieldRow>
      <FieldRow label="False branch">
        <TagList items={cfg.falseBranch} label="false_branch" />
      </FieldRow>
    </dl>
  );
}

function ParallelConfigCard({ cfg }: { cfg: ParallelNodeConfigJson }) {
  return (
    <dl>
      <FieldRow label="Max concurrency">
        <NumericField value={cfg.maxConcurrency} label="max_concurrency" />
      </FieldRow>
      <FieldRow label="Sub-nodes">
        {(cfg.subNodes?.length ?? 0) === 0 ? (
          <Unset label="sub_nodes" />
        ) : (
          <TagList items={cfg.subNodes?.map((n) => n.name ?? n.id ?? "?")} label="sub_nodes" />
        )}
      </FieldRow>
    </dl>
  );
}

function JoinConfigCard({ cfg }: { cfg: JoinNodeConfigJson }) {
  return (
    <dl>
      <FieldRow label="Wait for">
        <TagList items={cfg.waitFor} label="wait_for" />
      </FieldRow>
      <FieldRow label="Strategy">
        <StringField value={cfg.strategy} label="strategy" />
      </FieldRow>
      <FieldRow label="Aggregator (CEL)">
        <CodeBlock value={cfg.aggregator} label="aggregator" />
      </FieldRow>
    </dl>
  );
}

function NodeConfigVariant({ node }: { node: MissionNodeJson }) {
  if (node.agentConfig) return <AgentConfigCard cfg={node.agentConfig} />;
  if (node.toolConfig) return <ToolConfigCard cfg={node.toolConfig} />;
  if (node.pluginConfig) return <PluginConfigCard cfg={node.pluginConfig} />;
  if (node.conditionConfig) return <ConditionConfigCard cfg={node.conditionConfig} />;
  if (node.parallelConfig) return <ParallelConfigCard cfg={node.parallelConfig} />;
  if (node.joinConfig) return <JoinConfigCard cfg={node.joinConfig} />;
  return <p className="text-sm text-muted-foreground italic">No configuration variant set.</p>;
}

// -------------------------------------------------------------------------
// Per-node policies: retry, data, reuse
// -------------------------------------------------------------------------

function RetryPolicyCard({ p }: { p: RetryPolicyJson | undefined }) {
  if (!p) return <p className="text-sm text-muted-foreground italic">Default retry policy.</p>;
  return (
    <dl>
      <FieldRow label="Max retries">
        <NumericField value={p.maxRetries} label="max_retries" />
      </FieldRow>
      <FieldRow label="Backoff">
        <StringField value={p.backoffStrategy} label="backoff_strategy" />
      </FieldRow>
      <FieldRow label="Initial delay">
        <DurationField value={p.initialDelay} label="initial_delay" />
      </FieldRow>
      <FieldRow label="Max delay">
        <DurationField value={p.maxDelay} label="max_delay" />
      </FieldRow>
      <FieldRow label="Multiplier">
        {p.multiplier ? (
          <span className="tabular-nums">{p.multiplier}x</span>
        ) : (
          <Unset label="multiplier" />
        )}
      </FieldRow>
    </dl>
  );
}

function DataPolicyCard({ p }: { p: DataPolicyJson | undefined }) {
  if (!p) return <p className="text-sm text-muted-foreground italic">Default data policy.</p>;
  return (
    <dl>
      <FieldRow label="Store input">
        <BoolField value={p.storeInput} label="store_input" />
      </FieldRow>
      <FieldRow label="Store output">
        <BoolField value={p.storeOutput} label="store_output" />
      </FieldRow>
      <FieldRow label="Retention">
        <DurationField value={p.retention} label="retention" />
      </FieldRow>
      <FieldRow label="Encryption">
        <BoolField value={p.encryption} label="encryption" />
      </FieldRow>
      <FieldRow label="Access control">
        <TagList items={p.accessControl} label="access_control" />
      </FieldRow>
    </dl>
  );
}

function ReusePolicyCard({ p }: { p: ReusePolicyJson | undefined }) {
  if (!p) return <p className="text-sm text-muted-foreground italic">Default reuse policy.</p>;
  return (
    <dl>
      <FieldRow label="Output scope">
        <StringField value={p.outputScope} label="output_scope" />
      </FieldRow>
      <FieldRow label="Input scope">
        <StringField value={p.inputScope} label="input_scope" />
      </FieldRow>
      <FieldRow label="Reuse">
        <StringField value={p.reuse} label="reuse" />
      </FieldRow>
    </dl>
  );
}

// -------------------------------------------------------------------------
// MissionNode card (collapsible)
// -------------------------------------------------------------------------

function NODE_TYPE_LABEL(type: string | undefined): string {
  if (!type) return "Unknown";
  return type.replace("NODE_TYPE_", "").charAt(0).toUpperCase() +
    type.replace("NODE_TYPE_", "").slice(1).toLowerCase();
}

function MissionNodeCard({ node }: { node: MissionNodeJson }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card
        className="transition-colors data-[state=open]:border-primary/30"
        data-state={open ? "open" : "closed"}
      >
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={`Toggle ${node.name || node.id || "node"}`}
              className="flex items-center justify-between w-full text-left focus-visible:outline-none"
            >
              <div className="space-y-0.5">
                <CardTitle className="text-sm font-mono font-semibold">
                  {node.name || node.id || <Unset label="name" />}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {NODE_TYPE_LABEL(node.type)}
                  </Badge>
                  {node.id && (
                    <span className="text-xs text-muted-foreground font-mono">{node.id}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground ml-4">
                {open ? "collapse" : "expand"}
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {node.description && (
              <p className="text-sm text-muted-foreground">{node.description}</p>
            )}

            <Separator />

            {/* Common fields */}
            <div>
              <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Common
              </h5>
              <dl>
                <FieldRow label="Dependencies">
                  <TagList items={node.dependencies} label="dependencies" />
                </FieldRow>
                <FieldRow label="Timeout">
                  <DurationField value={node.timeout} label="timeout" />
                </FieldRow>
              </dl>
            </div>

            {/* Config variant */}
            <div>
              <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Configuration
              </h5>
              <NodeConfigVariant node={node} />
            </div>

            {/* Retry policy */}
            <div>
              <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Retry policy
              </h5>
              <RetryPolicyCard p={node.retryPolicy} />
            </div>

            {/* Data policy */}
            <div>
              <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Data policy
              </h5>
              <DataPolicyCard p={node.dataPolicy} />
            </div>

            {/* Reuse policy */}
            <div>
              <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Reuse policy
              </h5>
              <ReusePolicyCard p={node.reusePolicy} />
            </div>

            {/* Node metadata */}
            {node.metadata && Object.keys(node.metadata).length > 0 && (
              <div>
                <h5 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Metadata
                </h5>
                <dl>
                  {Object.entries(node.metadata).map(([k, v]) => (
                    <FieldRow key={k} label={k}>
                      <span>{v}</span>
                    </FieldRow>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// -------------------------------------------------------------------------
// Root component
// -------------------------------------------------------------------------

interface MissionDefinitionDetailProps {
  definition: MissionDefinitionJson;
}

export function MissionDefinitionDetail({ definition: def }: MissionDefinitionDetailProps) {
  const nodes = Object.values(def.nodes ?? {});

  const installedAt = def.installedAt
    ? new Date(def.installedAt).toLocaleString()
    : null;
  const createdAt = def.createdAt
    ? new Date(def.createdAt).toLocaleString()
    : null;

  return (
    <div className="space-y-6" data-testid="mission-definition-detail">
      {/* ---------------------------------------------------------------- */}
      {/* Overview section                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="overview-heading">
        <h2
          id="overview-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
        >
          Overview
        </h2>
        <Card>
          <CardContent className="pt-4">
            <dl>
              <FieldRow label="ID">
                <StringField value={def.id} label="id" />
              </FieldRow>
              <FieldRow label="Name">
                <StringField value={def.name} label="name" />
              </FieldRow>
              <FieldRow label="Description">
                <StringField value={def.description} label="description" />
              </FieldRow>
              <FieldRow label="Version">
                <StringField value={def.version} label="version" />
              </FieldRow>
              <FieldRow label="Target">
                <StringField value={def.targetRef} label="target_ref" />
              </FieldRow>
              <FieldRow label="Source">
                <StringField value={def.source} label="source" />
              </FieldRow>
              <FieldRow label="Installed at">
                {installedAt ? (
                  <span className="tabular-nums">{installedAt}</span>
                ) : (
                  <Unset label="installed_at" />
                )}
              </FieldRow>
              <FieldRow label="Created at">
                {createdAt ? (
                  <span className="tabular-nums">{createdAt}</span>
                ) : (
                  <Unset label="created_at" />
                )}
              </FieldRow>
              <FieldRow label="Entry points">
                <TagList items={def.entryPoints} label="entry_points" />
              </FieldRow>
              <FieldRow label="Exit points">
                <TagList items={def.exitPoints} label="exit_points" />
              </FieldRow>
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Constraints (ADR 0004, all 12 fields)                            */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="constraints-heading">
        <h2
          id="constraints-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1"
        >
          Constraints
        </h2>
        <ConstraintsSection c={def.constraints} />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Workspace                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="workspace-heading">
        <h2
          id="workspace-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1"
        >
          Workspace
        </h2>
        <WorkspaceSection w={def.workspace} />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Nodes                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="nodes-heading">
        <h2
          id="nodes-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"
        >
          Nodes ({nodes.length})
        </h2>
        {nodes.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No nodes defined.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {nodes.map((node, i) => (
              <MissionNodeCard key={node.id ?? i} node={node} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
