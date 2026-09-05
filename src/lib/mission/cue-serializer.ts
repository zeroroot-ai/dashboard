/**
 * CUE Serializer, converts a MissionDefinition proto back to CUE source text.
 *
 * The generated CUE is structurally equivalent to the templates under
 * src/data/templates/. It imports missionv1 and emits a
 * `mission: missionv1.#MissionDefinition & { ... }` block that the daemon's
 * ValidateMissionCUE RPC will accept without modification.
 *
 * Used by the clone route (GET /api/missions/[id]/clone) to pre-populate
 * the CUE editor with a copy of an existing mission definition.
 *
 * Spec: dashboard#352.
 */

import type { MissionDefinition, MissionNode } from '@/src/gen/gibson/mission/v1/mission_definition_pb';
import { NodeType } from '@/src/gen/gibson/mission/v1/mission_definition_pb';
import { DeliverableKind } from '@/src/gen/gibson/job/v1/job_pb';
import { JOB_IMPORT_LINE } from './job-node';

const IMPORT_LINE = 'import missionv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/mission/v1"';

const DELIVERABLE_NAME: Readonly<Record<number, string>> = {
  [DeliverableKind.PUSH_BRANCH]: 'DELIVERABLE_KIND_PUSH_BRANCH',
  [DeliverableKind.MERGE_REQUEST]: 'DELIVERABLE_KIND_MERGE_REQUEST',
  [DeliverableKind.NONE]: 'DELIVERABLE_KIND_NONE',
};

function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')}"`;
}

function nodeTypeName(t: NodeType): string {
  switch (t) {
    case NodeType.AGENT:     return 'missionv1.#NODE_TYPE_AGENT';
    case NodeType.TOOL:      return 'missionv1.#NODE_TYPE_TOOL';
    case NodeType.PLUGIN:    return 'missionv1.#NODE_TYPE_PLUGIN';
    case NodeType.CONDITION: return 'missionv1.#NODE_TYPE_CONDITION';
    case NodeType.PARALLEL:  return 'missionv1.#NODE_TYPE_PARALLEL';
    case NodeType.JOIN:      return 'missionv1.#NODE_TYPE_JOIN';
    case NodeType.JOB:       return 'missionv1.#NODE_TYPE_JOB';
    default:                 return 'missionv1.#NODE_TYPE_UNSPECIFIED';
  }
}

function serializeNode(node: MissionNode): string {
  const lines: string[] = [];
  lines.push(`\t\tid:   ${q(node.id)}`);
  lines.push(`\t\ttype: ${nodeTypeName(node.type)}`);
  if (node.name) lines.push(`\t\tname: ${q(node.name)}`);
  if (node.description) lines.push(`\t\tdescription: ${q(node.description)}`);

  switch (node.config.case) {
    case 'agentConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if (cfg.agentName) inner.push(`\t\t\tagentName: ${q(cfg.agentName)}`);
      if (cfg.task?.goal) inner.push(`\t\t\ttask: { goal: ${q(cfg.task.goal)} }`);
      if (inner.length) {
        lines.push(`\t\tagentConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\tagentConfig: {}`);
      }
      break;
    }
    case 'toolConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if (cfg.toolName) inner.push(`\t\t\ttoolName: ${q(cfg.toolName)}`);
      const inputKeys = Object.keys(cfg.input ?? {});
      if (inputKeys.length) {
        inner.push(`\t\t\tinput: {`);
        for (const k of inputKeys) inner.push(`\t\t\t\t${k}: ${q(cfg.input[k] ?? '')}`);
        inner.push(`\t\t\t}`);
      }
      if (inner.length) {
        lines.push(`\t\ttoolConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\ttoolConfig: {}`);
      }
      break;
    }
    case 'pluginConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if (cfg.pluginName) inner.push(`\t\t\tpluginName: ${q(cfg.pluginName)}`);
      if (cfg.method) inner.push(`\t\t\tmethod: ${q(cfg.method)}`);
      const paramKeys = Object.keys(cfg.params ?? {});
      if (paramKeys.length) {
        inner.push(`\t\t\tparams: {`);
        for (const k of paramKeys) inner.push(`\t\t\t\t${k}: ${q(cfg.params[k] ?? '')}`);
        inner.push(`\t\t\t}`);
      }
      if (inner.length) {
        lines.push(`\t\tpluginConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\tpluginConfig: {}`);
      }
      break;
    }
    case 'conditionConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if (cfg.expression) inner.push(`\t\t\texpression: ${q(cfg.expression)}`);
      if (cfg.trueBranch?.length)  inner.push(`\t\t\ttrueBranch:  [${cfg.trueBranch.map(q).join(', ')}]`);
      if (cfg.falseBranch?.length) inner.push(`\t\t\tfalseBranch: [${cfg.falseBranch.map(q).join(', ')}]`);
      if (inner.length) {
        lines.push(`\t\tconditionConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\tconditionConfig: {}`);
      }
      break;
    }
    case 'parallelConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if ((cfg.maxConcurrency ?? 0) > 0) inner.push(`\t\t\tmaxConcurrency: ${cfg.maxConcurrency}`);
      if (inner.length) {
        lines.push(`\t\tparallelConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\tparallelConfig: {}`);
      }
      break;
    }
    case 'jobConfig': {
      // gibson#1706 lane E4. Mirrors jobNodeToCue in ./job-node.ts.
      const cfg = node.config.value;
      const spec = cfg.spec;
      lines.push(`\t\tjobConfig: {`);
      lines.push(`\t\t\tbankRef: ${q(cfg.bankRef)}`);
      lines.push(`\t\t\tspec: {`);
      lines.push(`\t\t\t\tgoal: ${q(spec?.goal ?? '')}`);
      if (spec && spec.repositories.length > 0) {
        lines.push(`\t\t\t\trepositories: [`);
        for (const r of spec.repositories) {
          lines.push(`\t\t\t\t\t{`);
          lines.push(`\t\t\t\t\t\tname:         ${q(r.name)}`);
          lines.push(`\t\t\t\t\t\tconnectorRef: ${q(r.connectorRef)}`);
          lines.push(`\t\t\t\t\t\tproject:      ${q(r.project)}`);
          if (r.baseBranch) lines.push(`\t\t\t\t\t\tbaseBranch:   ${q(r.baseBranch)}`);
          const kind = DELIVERABLE_NAME[r.deliverable];
          if (kind) lines.push(`\t\t\t\t\t\tdeliverable:  jobv1.#${kind}`);
          lines.push(`\t\t\t\t\t},`);
        }
        lines.push(`\t\t\t\t]`);
      }
      if (spec && spec.credentialNames.length > 0) lines.push(`\t\t\t\tcredentialNames: [${spec.credentialNames.map(q).join(', ')}]`);
      if (spec && spec.inputs.length > 0) lines.push(`\t\t\t\tinputs: [${spec.inputs.map(q).join(', ')}]`);
      if (spec?.acceptance && spec.acceptance.verifierComponent) {
        lines.push(`\t\t\t\tacceptance: {`);
        lines.push(`\t\t\t\t\tverifierComponent: ${q(spec.acceptance.verifierComponent)}`);
        lines.push(`\t\t\t\t\tpassingScore:      ${spec.acceptance.passingScore}`);
        lines.push(`\t\t\t\t\tmaxPasses:         ${spec.acceptance.maxPasses}`);
        lines.push(`\t\t\t\t}`);
      }
      lines.push(`\t\t\t}`);
      if (cfg.constraints && (cfg.constraints.maxTurns > 0 || cfg.constraints.maxTokens > 0)) {
        lines.push(`\t\t\tconstraints: {`);
        if (cfg.constraints.maxTurns > 0) lines.push(`\t\t\t\tmaxTurns:  ${cfg.constraints.maxTurns}`);
        if (cfg.constraints.maxTokens > 0) lines.push(`\t\t\t\tmaxTokens: ${cfg.constraints.maxTokens}`);
        lines.push(`\t\t\t}`);
      }
      lines.push(`\t\t}`);
      break;
    }
    case 'joinConfig': {
      const cfg = node.config.value;
      const inner: string[] = [];
      if (cfg.waitFor?.length) inner.push(`\t\t\twaitFor: [${cfg.waitFor.map(q).join(', ')}]`);
      if (inner.length) {
        lines.push(`\t\tjoinConfig: {`);
        lines.push(...inner);
        lines.push(`\t\t}`);
      } else {
        lines.push(`\t\tjoinConfig: {}`);
      }
      break;
    }
    default:
      break;
  }

  return lines.join('\n');
}

/**
 * Convert a MissionDefinition proto to CUE source text.
 *
 * The returned string is ready to load into the CUE editor. The `name` field
 * is left as-is; the caller is responsible for appending " (copy)" or similar
 * before returning to the user.
 */
export function definitionToCUE(def: MissionDefinition): string {
  const parts: string[] = [];

  parts.push(IMPORT_LINE);
  // A job node names its deliverable through the job package.
  if (Object.values(def.nodes ?? {}).some((n) => n?.config.case === 'jobConfig')) parts.push(JOB_IMPORT_LINE);
  parts.push('');
  parts.push('mission: missionv1.#MissionDefinition & {');
  parts.push(`\tname:        ${q(def.name)}`);
  parts.push(`\tdescription: ${q(def.description ?? '')}`);
  parts.push(`\tversion:     ${q(def.version || '1.0.0')}`);
  parts.push(`\ttargetRef:   ${q(def.targetRef ?? '')}`);

  const nodeIds = Object.keys(def.nodes ?? {});
  if (nodeIds.length > 0) {
    parts.push('');
    parts.push('\tnodes: {');
    for (const id of nodeIds) {
      const node = def.nodes[id];
      if (!node) continue;
      parts.push(`\t\t${id}: {`);
      parts.push(serializeNode(node));
      parts.push('\t\t}');
    }
    parts.push('\t}');
  }

  if (def.edges && def.edges.length > 0) {
    const edgeItems = def.edges.map((e) => `{from: ${q(e.from)}, to: ${q(e.to)}}`);
    parts.push(`\tedges: [`);
    for (const item of edgeItems) parts.push(`\t\t${item},`);
    parts.push(`\t]`);
  }

  if (def.entryPoints && def.entryPoints.length > 0) {
    parts.push(`\tentryPoints: [${def.entryPoints.map(q).join(', ')}]`);
  }
  if (def.exitPoints && def.exitPoints.length > 0) {
    parts.push(`\texitPoints:  [${def.exitPoints.map(q).join(', ')}]`);
  }

  parts.push('}');
  return parts.join('\n') + '\n';
}
