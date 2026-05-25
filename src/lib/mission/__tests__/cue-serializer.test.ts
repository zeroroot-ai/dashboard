import { describe, it, expect } from 'vitest';
import { definitionToCUE } from '../cue-serializer';
import { create } from '@bufbuild/protobuf';
import {
  MissionDefinitionSchema,
  MissionNodeSchema,
  MissionEdgeSchema,
  AgentNodeConfigSchema,
  ToolNodeConfigSchema,
  NodeType,
} from '@/src/gen/gibson/mission/v1/mission_definition_pb';
import { TaskSchema } from '@/src/gen/gibson/types/v1/types_pb';

function agentNode(id: string, agentName: string, goal?: string) {
  return create(MissionNodeSchema, {
    id,
    type: NodeType.AGENT,
    config: {
      case: 'agentConfig',
      value: create(AgentNodeConfigSchema, {
        agentName,
        task: goal ? create(TaskSchema, { goal }) : undefined,
      }),
    },
  });
}

function toolNode(id: string, toolName: string, inputs: Record<string, string> = {}) {
  return create(MissionNodeSchema, {
    id,
    type: NodeType.TOOL,
    config: {
      case: 'toolConfig',
      value: create(ToolNodeConfigSchema, { toolName, input: inputs }),
    },
  });
}

describe('definitionToCUE', () => {
  it('emits the CUE import line', () => {
    const def = create(MissionDefinitionSchema, { name: 'test', version: '1.0.0' });
    const cue = definitionToCUE(def);
    expect(cue).toContain('import missionv1 "github.com/zero-day-ai/sdk/api/proto/gibson/mission/v1"');
  });

  it('wraps output in missionv1.#MissionDefinition & { }', () => {
    const def = create(MissionDefinitionSchema, { name: 'test' });
    const cue = definitionToCUE(def);
    expect(cue).toContain('mission: missionv1.#MissionDefinition & {');
    expect(cue).toContain('}');
  });

  it('serialises scalar fields', () => {
    const def = create(MissionDefinitionSchema, {
      name: 'recon',
      description: 'Recon scan',
      version: '2.3.0',
      targetRef: 'my-target',
    });
    const cue = definitionToCUE(def);
    expect(cue).toContain('name:        "recon"');
    expect(cue).toContain('description: "Recon scan"');
    expect(cue).toContain('version:     "2.3.0"');
    expect(cue).toContain('targetRef:   "my-target"');
  });

  it('escapes double-quotes in string values', () => {
    const def = create(MissionDefinitionSchema, { name: 'say "hello"' });
    const cue = definitionToCUE(def);
    expect(cue).toContain('"say \\"hello\\""');
  });

  it('serialises an AGENT node with agentName and task', () => {
    const def = create(MissionDefinitionSchema, {
      name: 'scan',
      nodes: {
        scan: agentNode('scan', 'nmap-agent', 'scan all ports'),
      },
    });
    const cue = definitionToCUE(def);
    expect(cue).toContain('scan: {');
    expect(cue).toContain('type: missionv1.#NODE_TYPE_AGENT');
    expect(cue).toContain('agentName: "nmap-agent"');
    expect(cue).toContain('task: { goal: "scan all ports" }');
  });

  it('serialises a TOOL node with inputs', () => {
    const def = create(MissionDefinitionSchema, {
      name: 'fetch',
      nodes: {
        get: toolNode('get', 'http-tool', { url: 'https://example.com' }),
      },
    });
    const cue = definitionToCUE(def);
    expect(cue).toContain('type: missionv1.#NODE_TYPE_TOOL');
    expect(cue).toContain('toolName: "http-tool"');
    expect(cue).toContain('url: "https://example.com"');
  });

  it('serialises edges', () => {
    const def = create(MissionDefinitionSchema, {
      name: 'chain',
      edges: [create(MissionEdgeSchema, { from: 'a', to: 'b' })],
    });
    const cue = definitionToCUE(def);
    expect(cue).toContain('{from: "a", to: "b"}');
  });

  it('serialises entryPoints and exitPoints', () => {
    const def = create(MissionDefinitionSchema, {
      name: 'chain',
      entryPoints: ['a'],
      exitPoints: ['b'],
    });
    const cue = definitionToCUE(def);
    expect(cue).toContain('entryPoints: ["a"]');
    expect(cue).toContain('exitPoints:  ["b"]');
  });

  it('produces output that round-trips the name field', () => {
    const def = create(MissionDefinitionSchema, { name: 'my-mission', version: '1.0.0' });
    const cue = definitionToCUE(def);
    const nameMatch = cue.match(/name:\s+"([^"]+)"/);
    expect(nameMatch?.[1]).toBe('my-mission');
  });
});
