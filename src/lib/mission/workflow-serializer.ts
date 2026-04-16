/**
 * Workflow Serializer
 *
 * Bi-directional conversion between workflow configuration and React Flow format.
 * Features:
 * - Workflow to React Flow nodes/edges
 * - React Flow to workflow steps
 * - YAML workflow parsing
 * - Inline and referenced workflow support
 */

import type { Node, Edge, MarkerType } from '@xyflow/react';
import type {
  WorkflowConfig,
  WorkflowStep,
  WorkflowStepType,
  WorkflowStepConfig,
  AgentStepConfig,
  ToolStepConfig,
  ConditionStepConfig,
  ParallelStepConfig,
  JoinStepConfig,
} from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  type: WorkflowStepType;
  stepConfig: WorkflowStep;
}

export interface ReactFlowWorkflow {
  nodes: Node<WorkflowNodeData>[];
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

// ============================================================================
// Workflow to React Flow
// ============================================================================

/**
 * Convert workflow configuration to React Flow nodes and edges
 */
export function workflowToReactFlow(
  workflow: WorkflowConfig,
  options: Partial<LayoutOptions> = {}
): ReactFlowWorkflow {
  const layout = { ...DEFAULT_LAYOUT, ...options };
  const nodes: Node<WorkflowNodeData>[] = [];
  const edges: Edge[] = [];

  // Calculate positions using topological sort
  const positions = calculateNodePositions(workflow.steps, layout);

  // Create nodes
  for (const step of workflow.steps) {
    const position = positions.get(step.id) || { x: layout.startX, y: nodes.length * layout.verticalSpacing + layout.startY };

    nodes.push({
      id: step.id,
      type: 'workflow',
      position,
      data: {
        label: step.name,
        type: step.type,
        stepConfig: step,
      },
    });
  }

  // Create edges from dependencies
  for (const step of workflow.steps) {
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
  steps: WorkflowStep[],
  layout: LayoutOptions
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

// ============================================================================
// React Flow to Workflow
// ============================================================================

/**
 * Convert React Flow nodes and edges back to workflow configuration
 */
export function reactFlowToWorkflow(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  existingConfig?: Partial<WorkflowConfig>
): WorkflowConfig {
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
  const steps: WorkflowStep[] = nodes.map((node) => ({
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
function determineExecutionMode(steps: WorkflowStep[]): 'sequential' | 'parallel' | 'dag' {
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
// YAML Parsing
// ============================================================================

/**
 * Parse workflow from YAML object
 */
export function parseWorkflowYAML(workflowData: any): WorkflowConfig {
  const steps: WorkflowStep[] = [];

  // Handle array of steps
  if (Array.isArray(workflowData)) {
    let prevStepId: string | null = null;

    for (let i = 0; i < workflowData.length; i++) {
      const stepData = workflowData[i];
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
  if (typeof workflowData === 'object' && workflowData !== null) {
    const executionMode = workflowData.type || 'sequential';

    // Sequential/DAG steps
    if (workflowData.steps) {
      let prevStepId: string | null = null;

      for (let i = 0; i < workflowData.steps.length; i++) {
        const stepData = workflowData.steps[i];
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
    if (workflowData.agents) {
      for (let i = 0; i < workflowData.agents.length; i++) {
        const agentData = workflowData.agents[i];
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
      errorHandling: workflowData.errorHandling || 'continue',
    };
  }

  // Empty or invalid workflow
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
function parseStepYAML(stepData: any, index: number): WorkflowStep {
  const id = stepData.id || `step-${index}`;
  let type: WorkflowStepType = 'agent';
  let config: WorkflowStepConfig;

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
// YAML Serialization
// ============================================================================

/**
 * Serialize workflow to YAML-ready object
 */
export function serializeWorkflowYAML(workflow: WorkflowConfig): any {
  if (workflow.steps.length === 0) {
    return undefined;
  }

  // Check if it's a simple sequential workflow
  const isSimpleSequential = workflow.steps.every((step, index) => {
    const deps = step.dependsOn ?? [];
    if (index === 0) return deps.length === 0;
    return (
      deps.length === 1 &&
      deps[0] === workflow.steps[index - 1].id
    );
  });

  if (isSimpleSequential && workflow.steps.every((s) => s.type === 'agent')) {
    // Output as simple array
    return workflow.steps.map((step) => {
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

  if (workflow.executionMode !== 'sequential') {
    output.type = workflow.executionMode;
  }

  output.steps = workflow.steps.map((step) => serializeStepYAML(step));

  return output;
}

/**
 * Serialize individual step to YAML-ready object
 */
function serializeStepYAML(step: WorkflowStep): any {
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
  workflowToReactFlow,
  reactFlowToWorkflow,
  parseWorkflowYAML,
  serializeWorkflowYAML,
};
