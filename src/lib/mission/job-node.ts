/**
 * The job node in the mission builder (gibson#1706 lane E4, epic decisions
 * 15 and 18).
 *
 * The builder is a CUE editor, so the "node form" is a dialog that emits one
 * CUE node into the definition's `nodes` block, and the definition page
 * reads the same node back from the daemon's JSON. This module holds the
 * three pure pieces: the form schema, which mirrors the daemon's OpenJob
 * checks so an error shows before submit; the CUE emitter; and the JSON
 * reader that feeds the form from a stored definition, so a definition
 * round-trips.
 *
 * Two design facts from sdk#549: `JobSpec` has no constraints, bounds ride on
 * `JobNodeConfig.constraints` (a `TaskConstraints`); the verify loop is
 * bounded by `Acceptance.max_passes`, not by `RetryPolicy`.
 */

import { z } from "zod";

const SLASH_REF = /^[a-z][a-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NODE_ID = /^[a-z][a-zA-Z0-9_]*$/;

export const DELIVERABLE_KINDS = ["merge_request", "push_branch", "none"] as const;
type DeliverableKindValue = (typeof DELIVERABLE_KINDS)[number];

const DELIVERABLE_CUE: Readonly<Record<DeliverableKindValue, string>> = {
  merge_request: "DELIVERABLE_KIND_MERGE_REQUEST",
  push_branch: "DELIVERABLE_KIND_PUSH_BRANCH",
  none: "DELIVERABLE_KIND_NONE",
};

const count = z.coerce.number().int().min(0, "Must be zero or more");

const repositorySchema = z.object({
  name: z.string().trim().min(1, "Worktree name is required").max(64),
  connectorRef: z
    .string()
    .trim()
    .regex(SLASH_REF, "Use the slash form, connector/<name>")
    .refine((v) => v.startsWith("connector/"), "Use the slash form, connector/<name>"),
  project: z.string().trim().min(1, "Project path is required, for example group/repo"),
  baseBranch: z.string().trim(),
  deliverable: z.enum(DELIVERABLE_KINDS),
});

export const jobNodeSchema = z
  .object({
    nodeId: z.string().trim().regex(NODE_ID, "A node id starts with a lower-case letter and has no spaces"),
    name: z.string().trim().max(120),
    bankRef: z.string().trim().min(1, "A bank is required"),
    goal: z.string().trim().min(1, "Say what the job must achieve"),
    repositories: z.array(repositorySchema),
    credentialNames: z.array(z.string().trim().min(1)),
    inputs: z.array(z.string().trim().min(1)),
    verifierComponent: z
      .string()
      .trim()
      .refine((v) => v === "" || (SLASH_REF.test(v) && (v.startsWith("agent/") || v.startsWith("tool/"))), "Use the slash form, agent/<name> or tool/<name>"),
    passingScore: z.coerce.number().min(0, "Score is 0 to 1").max(1, "Score is 0 to 1"),
    maxPasses: count,
    maxTurns: count,
    maxTokens: count,
    /** Node timeout in minutes: the deadline of the whole verify loop. Zero means none. */
    deadlineMinutes: count,
  })
  .superRefine((v, ctx) => {
    const names = new Set<string>();
    v.repositories.forEach((r, i) => {
      if (names.has(r.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["repositories", i, "name"], message: "Worktree names must be unique inside the job" });
      }
      names.add(r.name);
    });
    if (v.verifierComponent === "" && v.maxPasses > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPasses"], message: "Passes above one need a verifier" });
    }
  });

export type JobNodeFormValues = z.infer<typeof jobNodeSchema>;

export const EMPTY_JOB_NODE: JobNodeFormValues = {
  nodeId: "fix",
  name: "",
  bankRef: "",
  goal: "",
  repositories: [],
  credentialNames: [],
  inputs: [],
  verifierComponent: "",
  passingScore: 0.8,
  maxPasses: 3,
  maxTurns: 0,
  maxTokens: 0,
  deadlineMinutes: 0,
};

function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "")}"`;
}

function list(items: readonly string[]): string {
  return `[${items.map(q).join(", ")}]`;
}

/**
 * Emits one CUE node for the `nodes` block. Tabs match the shipped templates
 * (`src/data/templates/*.cue`) and the serializer, so the editor shows one
 * style. Lines the form left at their default are omitted, so the daemon
 * applies its defaults and the definition stays short.
 */
export function jobNodeToCue(v: JobNodeFormValues): string {
  const L: string[] = [];
  L.push(`\t\t${v.nodeId}: {`);
  L.push(`\t\t\tid:   ${q(v.nodeId)}`);
  L.push(`\t\t\ttype: missionv1.#NODE_TYPE_JOB`);
  if (v.name) L.push(`\t\t\tname: ${q(v.name)}`);
  if (v.deadlineMinutes > 0) L.push(`\t\t\ttimeout: ${q(`${v.deadlineMinutes * 60}s`)}`);
  L.push(`\t\t\tjobConfig: {`);
  L.push(`\t\t\t\tbankRef: ${q(v.bankRef)}`);
  L.push(`\t\t\t\tspec: {`);
  L.push(`\t\t\t\t\tgoal: ${q(v.goal)}`);
  if (v.repositories.length > 0) {
    L.push(`\t\t\t\t\trepositories: [`);
    for (const r of v.repositories) {
      L.push(`\t\t\t\t\t\t{`);
      L.push(`\t\t\t\t\t\t\tname:         ${q(r.name)}`);
      L.push(`\t\t\t\t\t\t\tconnectorRef: ${q(r.connectorRef)}`);
      L.push(`\t\t\t\t\t\t\tproject:      ${q(r.project)}`);
      if (r.baseBranch) L.push(`\t\t\t\t\t\t\tbaseBranch:   ${q(r.baseBranch)}`);
      L.push(`\t\t\t\t\t\t\tdeliverable:  jobv1.#${DELIVERABLE_CUE[r.deliverable]}`);
      L.push(`\t\t\t\t\t\t},`);
    }
    L.push(`\t\t\t\t\t]`);
  }
  if (v.credentialNames.length > 0) L.push(`\t\t\t\t\tcredentialNames: ${list(v.credentialNames)}`);
  if (v.inputs.length > 0) L.push(`\t\t\t\t\tinputs: ${list(v.inputs)}`);
  if (v.verifierComponent) {
    L.push(`\t\t\t\t\tacceptance: {`);
    L.push(`\t\t\t\t\t\tverifierComponent: ${q(v.verifierComponent)}`);
    L.push(`\t\t\t\t\t\tpassingScore:      ${v.passingScore}`);
    L.push(`\t\t\t\t\t\tmaxPasses:         ${v.maxPasses}`);
    L.push(`\t\t\t\t\t}`);
  }
  L.push(`\t\t\t\t}`);
  if (v.maxTurns > 0 || v.maxTokens > 0) {
    L.push(`\t\t\t\tconstraints: {`);
    if (v.maxTurns > 0) L.push(`\t\t\t\t\tmaxTurns:  ${v.maxTurns}`);
    if (v.maxTokens > 0) L.push(`\t\t\t\t\tmaxTokens: ${v.maxTokens}`);
    L.push(`\t\t\t\t}`);
  }
  L.push(`\t\t\t}`);
  L.push(`\t\t}`);
  return L.join("\n");
}

/** The import line the job node needs beside the mission one. */
export const JOB_IMPORT_LINE = 'import jobv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/job/v1"';
const MISSION_IMPORT_LINE = 'import missionv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/mission/v1"';

/**
 * Inserts a node snippet into the definition's `nodes: {` block, first
 * position, and adds the job import when absent. When the source has no
 * `nodes` block, one is added before `entryPoints`, or at the end of the
 * mission block. Returns the source unchanged when the node id is already
 * present, so a double click does not duplicate a node.
 */
export function insertNodeIntoCue(source: string, nodeId: string, snippet: string): string {
  if (new RegExp(`^\\t\\t${nodeId}: \\{`, "m").test(source)) return source;
  let out = source;
  if (snippet.includes("jobv1.#") && !out.includes(JOB_IMPORT_LINE)) {
    out = out.includes(MISSION_IMPORT_LINE)
      ? out.replace(MISSION_IMPORT_LINE, `${MISSION_IMPORT_LINE}\n${JOB_IMPORT_LINE}`)
      : `${JOB_IMPORT_LINE}\n\n${out}`;
  }
  const nodesOpen = /^\tnodes: \{[ \t]*$/m.exec(out);
  if (nodesOpen) {
    const at = nodesOpen.index + nodesOpen[0].length;
    return `${out.slice(0, at)}\n${snippet}${out.slice(at)}`;
  }
  const block = `\tnodes: {\n${snippet}\n\t}\n`;
  const entry = /^\tentryPoints:/m.exec(out);
  if (entry) return `${out.slice(0, entry.index)}${block}${out.slice(entry.index)}`;
  const close = out.lastIndexOf("\n}");
  if (close >= 0) return `${out.slice(0, close)}\n${block}${out.slice(close + 1)}`;
  return `${out}\n${block}`;
}

/** The `jobConfig` shape as the definition route returns it (protobuf JSON). */
export interface JobNodeConfigJson {
  bankRef?: string;
  spec?: {
    goal?: string;
    repositories?: Array<{
      name?: string;
      connectorRef?: string;
      project?: string;
      baseBranch?: string;
      deliverable?: string;
    }>;
    credentialNames?: string[];
    inputs?: string[];
    acceptance?: { verifierComponent?: string; passingScore?: number; maxPasses?: number };
  };
  constraints?: { maxTurns?: number; maxTokens?: number };
}

function deliverableFromJson(v: string | undefined): DeliverableKindValue {
  switch (v) {
    case "DELIVERABLE_KIND_PUSH_BRANCH":
    case "push_branch":
      return "push_branch";
    case "DELIVERABLE_KIND_NONE":
    case "none":
      return "none";
    default:
      return "merge_request";
  }
}

/** Seconds from a protobuf JSON duration such as `"1800s"`. */
function durationSeconds(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v);
  return m ? Math.round(Number(m[1])) : 0;
}

/**
 * Feeds the form from a stored node, so the form shows what was submitted.
 * The inverse of `jobNodeToCue` for every field the form owns.
 */
export function jobNodeValuesFromJson(
  nodeId: string,
  node: { name?: string; timeout?: string; jobConfig?: JobNodeConfigJson },
): JobNodeFormValues {
  const cfg = node.jobConfig ?? {};
  const spec = cfg.spec ?? {};
  return {
    nodeId,
    name: node.name ?? "",
    bankRef: cfg.bankRef ?? "",
    goal: spec.goal ?? "",
    repositories: (spec.repositories ?? []).map((r) => ({
      name: r.name ?? "",
      connectorRef: r.connectorRef ?? "",
      project: r.project ?? "",
      baseBranch: r.baseBranch ?? "",
      deliverable: deliverableFromJson(r.deliverable),
    })),
    credentialNames: [...(spec.credentialNames ?? [])],
    inputs: [...(spec.inputs ?? [])],
    verifierComponent: spec.acceptance?.verifierComponent ?? "",
    passingScore: spec.acceptance?.passingScore ?? EMPTY_JOB_NODE.passingScore,
    maxPasses: spec.acceptance?.maxPasses ?? (spec.acceptance ? 0 : EMPTY_JOB_NODE.maxPasses),
    maxTurns: cfg.constraints?.maxTurns ?? 0,
    maxTokens: cfg.constraints?.maxTokens ?? 0,
    deadlineMinutes: Math.round(durationSeconds(node.timeout) / 60),
  };
}
