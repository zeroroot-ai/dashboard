/**
 * Mission Serializer
 *
 * Converts the dashboard's authored-mission model (produced by the Monaco
 * YAML editor + `parser.ts`) into a wire-format `MissionDefinition` proto
 * message. YAML remains a client-side authoring convenience; the wire
 * format sent to the daemon is proto JSON only, not YAML.
 *
 * Also retains bidirectional React Flow helpers so the existing visual
 * builder UI continues to function.
 */

import type { Node, Edge } from '@xyflow/react';
import { create } from '@bufbuild/protobuf';
import {
  MissionDefinitionSchema,
  MissionNodeSchema,
  MissionEdgeSchema,
  AgentNodeConfigSchema,
  ToolNodeConfigSchema,
  ConditionNodeConfigSchema,
  ParallelNodeConfigSchema,
  NodeType,
  type MissionDefinition,
  type MissionNode,
  type MissionEdge,
} from '@/src/gen/gibson/mission/v1/mission_definition_pb';
import { TaskSchema } from '@/src/gen/gibson/types/v1/types_pb';
import type {
  MissionCreationState,
  MissionMetadata,
  ScopeConfig,
  MissionConfig,
  MissionStep,
  MissionStepType,
  MissionStepConfig,
  AgentStepConfig,
  ToolStepConfig,
  ConditionStepConfig,
  ParallelStepConfig,
  JoinStepConfig,
} from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface MissionNodeData extends Record<string, unknown> {
  label: string;
  type: MissionStepType;
  stepConfig: MissionStep;
}

export interface ReactFlowMission {
  nodes: Node<MissionNodeData>[];
  edges: Edge[];
}

export interface LayoutOptions {
  /** Horizontal spacing between nodes */
  horizontalSpacing: number;
  /** Vertical spacing between nodes */
  verticalSpacing: number;
  /** Starting X position */
  startX: number;
  /** Starting Y position */
  startY: number;
}

const DEFAULT_LAYOUT: LayoutOptions = {
  horizontalSpacing: 200,
  verticalSpacing: 100,
  startX: 100,
  startY: 50,
};

/**
 * Input accepted by {@link serializeToMissionDefinition}. This is the subset of
 * the authored mission state that is meaningful to the daemon's
 * `MissionDefinition` proto — YAML content, validation state, UI tabs, and
 * drafts are intentionally excluded.
 */
export interface AuthoredMissionInput {
  metadata: MissionMetadata;
  scope: ScopeConfig;
  mission: MissionConfig;
  /**
   * Optional explicit identifier for the mission definition. When omitted, the
   * daemon will assign one at registration time.
   */
  id?: string;
  /**
   * Optional explicit version string. Defaults to `"1.0.0"` if the metadata
   * does not carry one.
   */
  version?: string;
}

// ============================================================================
// Authoring Model → Proto (wire format)
// ============================================================================

/**
 * Convert the dashboard's authored mission model into a wire-format
 * `MissionDefinition` proto message. This is the shape sent to the daemon's
 * `CreateMissionDefinition` RPC. No YAML ever leaves the browser.
 *
 * Field mapping:
 * - `metadata.name`        → `name`
 * - `metadata.description` → `description`
 * - `metadata.tags`        → `metadata["tags"]` (comma-joined)
 * - `scope.seeds[0].value` → `target_ref`
 * - `mission.steps[]`      → `nodes` map (keyed by step id) + derived `edges`
 * - dependency graph       → `entry_points` / `exit_points`
 */
export function serializeToMissionDefinition(
  input: AuthoredMissionInput,
): MissionDefinition {
  const nodes: { [id: string]: MissionNode } = {};
  const edges: MissionEdge[] = [];

  for (const step of input.mission.steps) {
    nodes[step.id] = buildMissionNode(step);
    for (const dep of step.dependsOn ?? []) {
      edges.push(create(MissionEdgeSchema, { from: dep, to: step.id }));
    }
  }

  const { entryPoints, exitPoints } = computeEntryExitPoints(input.mission.steps);

  // Build metadata map from tags + custom fields.
  const metadata: { [k: string]: string } = {};
  if (input.metadata.tags?.length) {
    metadata.tags = input.metadata.tags.join(',');
  }
  if (input.metadata.priority) {
    metadata.priority = input.metadata.priority;
  }
  if (input.metadata.customFields) {
    for (const [k, v] of Object.entries(input.metadata.customFields)) {
      if (v != null) metadata[k] = String(v);
    }
  }

  const targetRef = input.scope.seeds?.[0]?.value ?? '';

  return create(MissionDefinitionSchema, {
    id: input.id ?? '',
    name: input.metadata.name,
    description: input.metadata.description,
    version: input.version ?? '1.0.0',
    targetRef,
    nodes,
    edges,
    entryPoints,
    exitPoints,
    metadata,
    // `dependencies`, `source`, `installedAt`, `createdAt` are server-managed —
    // leave unset on create.
  });
}

/**
 * Build a single `MissionNode` proto from an authored step.
 */
function buildMissionNode(step: MissionStep): MissionNode {
  const node: Parameters<typeof create<typeof MissionNodeSchema>>[1] = {
    id: step.id,
    name: step.name,
    description: '',
    dependencies: step.dependsOn ?? [],
    metadata: {},
    type: missionStepTypeToProto(step.type),
  };

  switch (step.config.type) {
    case 'agent': {
      const cfg = step.config as AgentStepConfig;
      node.config = {
        case: 'agentConfig',
        value: create(AgentNodeConfigSchema, {
          agentName: cfg.agentId,
          task: create(TaskSchema, { goal: cfg.task ?? '' }),
        }),
      };
      break;
    }
    case 'tool': {
      const cfg = step.config as ToolStepConfig;
      const input: { [k: string]: string } = {};
      for (const [k, v] of Object.entries(cfg.inputs ?? {})) {
        if (v != null) input[k] = String(v);
      }
      node.config = {
        case: 'toolConfig',
        value: create(ToolNodeConfigSchema, {
          toolName: cfg.toolId,
          input,
        }),
      };
      break;
    }
    case 'condition': {
      const cfg = step.config as ConditionStepConfig;
      node.config = {
        case: 'conditionConfig',
        value: create(ConditionNodeConfigSchema, {
          expression: cfg.expression,
          trueBranch: cfg.ifTrue ? [cfg.ifTrue] : [],
          falseBranch: cfg.ifFalse ? [cfg.ifFalse] : [],
        }),
      };
      break;
    }
    case 'parallel': {
      const cfg = step.config as ParallelStepConfig;
      // Parallel sub-nodes are referenced by id in the authoring model but the
      // proto wants full MissionNode values. Since each branch target is also
      // present at the top level of the mission map, we just record the
      // branch ids in metadata so the daemon can resolve them by key — the
      // executor walks edges anyway.
      node.config = {
        case: 'parallelConfig',
        value: create(ParallelNodeConfigSchema, {
          subNodes: [],
          maxConcurrency: cfg.maxConcurrency ?? 0,
        }),
      };
      node.metadata = { ...node.metadata, branches: cfg.branches.join(',') };
      break;
    }
    case 'join': {
      const cfg = step.config as JoinStepConfig;
      // No dedicated join config in the proto; encode dependencies via the
      // standard `dependencies` field plus metadata.
      node.metadata = {
        ...node.metadata,
        waitFor: cfg.waitFor.join(','),
        mergeStrategy: cfg.mergeStrategy,
      };
      break;
    }
    default: {
      // Fallback for plugin / unknown — leave config unset.
      break;
    }
  }

  return create(MissionNodeSchema, node);
}

function missionStepTypeToProto(t: MissionStepType): NodeType {
  switch (t) {
    case 'agent':
      return NodeType.AGENT;
    case 'tool':
      return NodeType.TOOL;
    case 'plugin':
      return NodeType.PLUGIN;
    case 'condition':
      return NodeType.CONDITION;
    case 'parallel':
      return NodeType.PARALLEL;
    case 'join':
      return NodeType.JOIN;
    case 'wait':
      // No dedicated wait node type in the proto; map to JOIN as the nearest
      // semantic equivalent (a barrier).
      return NodeType.JOIN;
    default:
      return NodeType.UNSPECIFIED;
  }
}

/**
 * Compute entry / exit node ids from the authored mission graph.
 *
 * - Entry points have no incoming dependencies.
 * - Exit points have no outgoing dependencies (nothing references them).
 */
function computeEntryExitPoints(steps: MissionStep[]): {
  entryPoints: string[];
  exitPoints: string[];
} {
  const incoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      incoming.add(step.id);
      hasOutgoing.add(dep);
    }
  }
  const entryPoints: string[] = [];
  const exitPoints: string[] = [];
  for (const step of steps) {
    if (!incoming.has(step.id)) entryPoints.push(step.id);
    if (!hasOutgoing.has(step.id)) exitPoints.push(step.id);
  }
  return { entryPoints, exitPoints };
}

/**
 * Convenience: accept a full `MissionCreationState` (what the store holds)
 * and extract the subset relevant to the proto.
 */
export function serializeStateToMissionDefinition(
  state: Pick<MissionCreationState, 'metadata' | 'scope' | 'mission'>,
  overrides: { id?: string; version?: string } = {},
): MissionDefinition {
  return serializeToMissionDefinition({
    metadata: state.metadata,
    scope: state.scope,
    mission: state.mission,
    ...overrides,
  });
}

// ============================================================================
// Authoring Model ↔ React Flow (unchanged)
// ============================================================================

/**
 * Convert mission configuration to React Flow nodes and edges
 */
export function missionToReactFlow(
  mission: MissionConfig,
  options: Partial<LayoutOptions> = {},
): ReactFlowMission {
  const layout = { ...DEFAULT_LAYOUT, ...options };
  const nodes: Node<MissionNodeData>[] = [];
  const edges: Edge[] = [];

  // Calculate positions using topological sort
  const positions = calculateNodePositions(mission.steps, layout);

  // Create nodes
  for (const step of mission.steps) {
    const position =
      positions.get(step.id) || {
        x: layout.startX,
        y: nodes.length * layout.verticalSpacing + layout.startY,
      };

    nodes.push({
      id: step.id,
      type: 'mission',
      position,
      data: {
        label: step.name,
        type: step.type,
        stepConfig: step,
      },
    });
  }

  // Create edges from dependencies
  for (const step of mission.steps) {
    for (const depId of step.dependsOn ?? []) {
      edges.push({
        id: `${depId}-${step.id}`,
        source: depId,
        target: step.id,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: 'arrowclosed' as any },
      });
    }

    // Handle condition step edges
    if (step.type === 'condition' && step.config.type === 'condition') {
      const config = step.config as ConditionStepConfig;
      if (config.ifTrue) {
        edges.push({
          id: `${step.id}-true-${config.ifTrue}`,
          source: step.id,
          target: config.ifTrue,
          type: 'smoothstep',
          animated: true,
          label: 'true',
          markerEnd: { type: 'arrowclosed' as any },
          style: { stroke: '#22c55e' },
        });
      }
      if (config.ifFalse) {
        edges.push({
          id: `${step.id}-false-${config.ifFalse}`,
          source: step.id,
          target: config.ifFalse,
          type: 'smoothstep',
          animated: true,
          label: 'false',
          markerEnd: { type: 'arrowclosed' as any },
          style: { stroke: '#ef4444' },
        });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Calculate node positions using topological layers
 */
function calculateNodePositions(
  steps: MissionStep[],
  layout: LayoutOptions,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Build dependency graph
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, (step.dependsOn ?? []).length);
    if (!outEdges.has(step.id)) {
      outEdges.set(step.id, []);
    }
    for (const dep of step.dependsOn ?? []) {
      const existing = outEdges.get(dep) || [];
      existing.push(step.id);
      outEdges.set(dep, existing);
    }
  }

  // Topological sort into layers
  const layers: string[][] = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    const layer: string[] = [];

    for (const id of remaining) {
      if ((inDegree.get(id) || 0) === 0) {
        layer.push(id);
      }
    }

    if (layer.length === 0) {
      // Handle cycles - just add remaining nodes
      layer.push(...remaining);
      remaining.clear();
    } else {
      for (const id of layer) {
        remaining.delete(id);
        for (const next of outEdges.get(id) || []) {
          inDegree.set(next, (inDegree.get(next) || 0) - 1);
        }
      }
    }

    layers.push(layer);
  }

  // Assign positions based on layers
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    const y = layout.startY + layerIndex * layout.verticalSpacing;

    for (let nodeIndex = 0; nodeIndex < layer.length; nodeIndex++) {
      const x = layout.startX + nodeIndex * layout.horizontalSpacing;
      positions.set(layer[nodeIndex], { x, y });
    }
  }

  return positions;
}

/**
 * Convert React Flow nodes and edges back to mission configuration
 */
export function reactFlowToMission(
  nodes: Node<MissionNodeData>[],
  edges: Edge[],
  existingConfig?: Partial<MissionConfig>,
): MissionConfig {
  // Build dependency map from edges
  const dependencies = new Map<string, string[]>();

  for (const edge of edges) {
    // Skip condition edges (they're handled separately)
    if (edge.label === 'true' || edge.label === 'false') continue;

    const deps = dependencies.get(edge.target) || [];
    deps.push(edge.source);
    dependencies.set(edge.target, deps);
  }

  // Convert nodes to steps
  const steps: MissionStep[] = nodes.map((node) => ({
    ...node.data.stepConfig,
    dependsOn: dependencies.get(node.id) || [],
  }));

  return {
    type: existingConfig?.type || 'inline',
    steps,
    executionMode: existingConfig?.executionMode || determineExecutionMode(steps),
    errorHandling: existingConfig?.errorHandling || 'continue',
    reference: existingConfig?.reference,
  };
}

/**
 * Determine execution mode from step structure
 */
function determineExecutionMode(steps: MissionStep[]): 'sequential' | 'parallel' | 'dag' {
  // If any step has multiple dependencies, it's a DAG
  for (const step of steps) {
    if ((step.dependsOn ?? []).length > 1) {
      return 'dag';
    }
  }

  // If steps form a simple chain, it's sequential
  const hasAnyDependency = steps.some((s) => (s.dependsOn ?? []).length > 0);
  if (!hasAnyDependency && steps.length > 1) {
    return 'parallel';
  }

  return 'sequential';
}

// ============================================================================
// Client-side YAML Parsing (authoring convenience only — not wire format)
// ============================================================================

/**
 * Parse an authored mission fragment (the `mission:` block of the user's
 * YAML) into the structured {@link MissionConfig} model.
 */
export function parseMissionYAML(missionData: any): MissionConfig {
  const steps: MissionStep[] = [];

  // Handle array of steps
  if (Array.isArray(missionData)) {
    let prevStepId: string | null = null;

    for (let i = 0; i < missionData.length; i++) {
      const stepData = missionData[i];
      const step = parseStepYAML(stepData, i);

      // If no explicit dependencies, depend on previous step
      if ((step.dependsOn ?? []).length === 0 && prevStepId) {
        step.dependsOn = [prevStepId];
      }

      steps.push(step);
      prevStepId = step.id;
    }

    return {
      type: 'inline',
      steps,
      executionMode: 'sequential',
      errorHandling: 'continue',
    };
  }

  // Handle object with type and steps
  if (typeof missionData === 'object' && missionData !== null) {
    const executionMode = missionData.type || 'sequential';

    // Sequential/DAG steps
    if (missionData.steps) {
      let prevStepId: string | null = null;

      for (let i = 0; i < missionData.steps.length; i++) {
        const stepData = missionData.steps[i];
        const step = parseStepYAML(stepData, i);

        // If sequential and no explicit dependencies, depend on previous
        if (executionMode === 'sequential' && (step.dependsOn ?? []).length === 0 && prevStepId) {
          step.dependsOn = [prevStepId];
        }

        steps.push(step);
        prevStepId = step.id;
      }
    }

    // Parallel agents
    if (missionData.agents) {
      for (let i = 0; i < missionData.agents.length; i++) {
        const agentData = missionData.agents[i];
        steps.push({
          id: agentData.name || `agent-${i}`,
          type: 'agent',
          name: agentData.name || `Agent ${i + 1}`,
          config: {
            type: 'agent',
            agentId: agentData.name,
            task: agentData.task || '',
          },
          dependsOn: [],
        });
      }
    }

    return {
      type: 'inline',
      steps,
      executionMode: executionMode as any,
      errorHandling: missionData.errorHandling || 'continue',
    };
  }

  // Empty or invalid mission
  return {
    type: 'inline',
    steps: [],
    executionMode: 'sequential',
    errorHandling: 'continue',
  };
}

/**
 * Parse individual step from YAML
 */
function parseStepYAML(stepData: any, index: number): MissionStep {
  const id = stepData.id || `step-${index}`;
  let type: MissionStepType = 'agent';
  let config: MissionStepConfig;

  if (stepData.agent) {
    type = 'agent';
    config = {
      type: 'agent',
      agentId: stepData.agent,
      task: stepData.task || '',
      parameters: stepData.parameters,
    };
  } else if (stepData.tool) {
    type = 'tool';
    config = {
      type: 'tool',
      toolId: stepData.tool,
      inputs: stepData.parameters || stepData.inputs || {},
    };
  } else if (stepData.type === 'condition') {
    type = 'condition';
    config = {
      type: 'condition',
      expression: stepData.expression || '',
      ifTrue: stepData.ifTrue || '',
      ifFalse: stepData.ifFalse || '',
    };
  } else if (stepData.type === 'parallel') {
    type = 'parallel';
    config = {
      type: 'parallel',
      branches: stepData.branches || [],
      maxConcurrency: stepData.maxConcurrency,
    };
  } else if (stepData.type === 'join') {
    type = 'join';
    config = {
      type: 'join',
      waitFor: stepData.waitFor || [],
      mergeStrategy: stepData.mergeStrategy || 'all',
    };
  } else {
    // Default to agent
    config = {
      type: 'agent',
      agentId: '',
      task: stepData.task || '',
    };
  }

  return {
    id,
    type,
    name: stepData.name || stepData.agent || stepData.tool || `Step ${index + 1}`,
    config,
    dependsOn: stepData.dependsOn || [],
    timeout: stepData.timeout,
    condition: stepData.condition
      ? { type: 'cel', expression: stepData.condition }
      : undefined,
    retry: stepData.retry,
  };
}

// ============================================================================
// Client-side YAML Serialization (authoring convenience only — not wire format)
// ============================================================================

/**
 * Serialize an authored {@link MissionConfig} into a YAML-ready object
 * suitable for display in the Monaco editor. This is the *authoring* shape —
 * it is NOT what the daemon sees.
 */
export function serializeMissionYAML(mission: MissionConfig): any {
  if (mission.steps.length === 0) {
    return undefined;
  }

  // Check if it's a simple sequential mission
  const isSimpleSequential = mission.steps.every((step, index) => {
    const deps = step.dependsOn ?? [];
    if (index === 0) return deps.length === 0;
    return (
      deps.length === 1 &&
      deps[0] === mission.steps[index - 1].id
    );
  });

  if (isSimpleSequential && mission.steps.every((s) => s.type === 'agent')) {
    // Output as simple array
    return mission.steps.map((step) => {
      const config = step.config as AgentStepConfig;
      const output: any = {
        agent: config.agentId,
        task: config.task,
      };
      if (config.parameters && Object.keys(config.parameters).length > 0) {
        output.parameters = config.parameters;
      }
      return output;
    });
  }

  // Output as object with type and steps
  const output: any = {};

  if (mission.executionMode !== 'sequential') {
    output.type = mission.executionMode;
  }

  output.steps = mission.steps.map((step) => serializeStepYAML(step));

  return output;
}

/**
 * Serialize individual step to YAML-ready object
 */
function serializeStepYAML(step: MissionStep): any {
  const output: any = {};

  if (step.id) {
    output.id = step.id;
  }

  switch (step.type) {
    case 'agent': {
      const config = step.config as AgentStepConfig;
      output.agent = config.agentId;
      output.task = config.task;
      if (config.parameters && Object.keys(config.parameters).length > 0) {
        output.parameters = config.parameters;
      }
      break;
    }
    case 'tool': {
      const config = step.config as ToolStepConfig;
      output.type = 'tool';
      output.tool = config.toolId;
      if (Object.keys(config.inputs).length > 0) {
        output.parameters = config.inputs;
      }
      break;
    }
    case 'condition': {
      const config = step.config as ConditionStepConfig;
      output.type = 'condition';
      output.expression = config.expression;
      output.ifTrue = config.ifTrue;
      output.ifFalse = config.ifFalse;
      break;
    }
    case 'parallel': {
      const config = step.config as ParallelStepConfig;
      output.type = 'parallel';
      output.branches = config.branches;
      if (config.maxConcurrency) {
        output.maxConcurrency = config.maxConcurrency;
      }
      break;
    }
    case 'join': {
      const config = step.config as JoinStepConfig;
      output.type = 'join';
      output.waitFor = config.waitFor;
      output.mergeStrategy = config.mergeStrategy;
      break;
    }
  }

  if ((step.dependsOn ?? []).length > 0) {
    output.dependsOn = step.dependsOn;
  }

  if (step.timeout) {
    output.timeout = step.timeout;
  }

  if (step.condition) {
    output.condition = step.condition.expression;
  }

  return output;
}

// ============================================================================
// Export
// ============================================================================

export default {
  serializeToMissionDefinition,
  serializeStateToMissionDefinition,
  missionToReactFlow,
  reactFlowToMission,
  parseMissionYAML,
  serializeMissionYAML,
};
