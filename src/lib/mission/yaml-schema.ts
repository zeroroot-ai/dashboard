/**
 * Mission YAML JSON Schema
 *
 * Comprehensive JSON Schema (draft-07) for validating Gibson mission YAML files.
 * Property names match the Go YAML struct tags in core/gibson/internal/mission/yaml.go.
 * This schema defines the structure for mission configuration including:
 * - Mission metadata (name, description)
 * - Target configuration (reference or inline seeds)
 * - Workflow definition (reference or inline nodes/edges)
 * - Constraints (max_duration, max_findings, max_cost, severity_threshold)
 * - Guardrails (rate limits, allowed agents, confirmation requirements)
 * - Reporting (formats, output_path, email_to, webhooks)
 */

import type { JSONSchema7 } from 'json-schema';

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Schema for a target seed (maps to TargetSeedConfig in yaml.go)
 */
const targetSeedSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    value: {
      type: 'string',
      minLength: 1,
      description: 'Target value (URL, domain, IP address, CIDR range, repository URL, etc.)',
    },
    type: {
      type: 'string',
      enum: ['url', 'domain', 'ip', 'cidr', 'repository', 'api'],
      description: 'Type of target seed',
    },
    scope: {
      type: 'string',
      description: 'Optional scope qualifier for the seed',
    },
  },
  required: ['value', 'type'],
  additionalProperties: true,
};

/**
 * Schema for inline target configuration (maps to InlineTargetConfig in yaml.go)
 */
const inlineTargetSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    seeds: {
      type: 'array',
      items: targetSeedSchema,
      minItems: 1,
      description: 'Initial targets for the mission (URLs, domains, IPs, CIDRs)',
    },
    profile: {
      type: 'string',
      minLength: 1,
      description: 'Scope profile name (e.g., "web-app", "network", "api")',
    },
    depth: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      default: 3,
      description: 'Maximum crawl depth from seed targets',
    },
    excluded: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'Patterns to exclude from scope (regex or glob)',
    },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Optional metadata for the target',
    },
  },
  required: ['seeds', 'profile'],
  additionalProperties: true,
};

/**
 * Schema for target configuration (maps to MissionTargetConfig in yaml.go)
 */
const targetSchema: JSONSchema7 = {
  type: 'object',
  additionalProperties: true,
  description: 'Target configuration (validated by daemon)',
};

/**
 * Schema for a workflow edge (maps to WorkflowEdgeConfig in yaml.go)
 */
const workflowEdgeSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    from: {
      type: 'string',
      description: 'Source node ID',
    },
    to: {
      type: 'string',
      description: 'Destination node ID',
    },
    condition: {
      type: 'string',
      description: 'Optional condition expression controlling traversal',
    },
  },
  required: ['from', 'to'],
  additionalProperties: true,
};

/**
 * Schema for a workflow node (maps to WorkflowNodeConfig in yaml.go)
 */
const workflowNodeSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier for this node',
    },
    type: {
      type: 'string',
      description: 'Node execution type (agent, tool, condition, parallel, join)',
    },
    name: {
      type: 'string',
      description: 'Human-readable name for the node',
    },
  },
  required: ['id', 'type'],
  additionalProperties: true,
};

/**
 * Schema for inline workflow configuration (maps to InlineWorkflowConfig in yaml.go)
 */
const inlineWorkflowSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Optional name for this inline workflow',
    },
    nodes: {
      type: 'array',
      items: workflowNodeSchema,
      minItems: 1,
      description: 'Workflow nodes to execute',
    },
    edges: {
      type: 'array',
      items: workflowEdgeSchema,
      description: 'Directed edges defining execution order (DAG)',
    },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Optional metadata for the workflow',
    },
  },
  required: ['nodes'],
  additionalProperties: true,
};

/**
 * Schema for workflow configuration (maps to MissionWorkflowConfig in yaml.go)
 */
const workflowSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    reference: {
      type: 'string',
      minLength: 1,
      description: 'Reference to an existing workflow by name or ID',
    },
    inline: {
      ...inlineWorkflowSchema,
      description: 'Inline workflow definition',
    },
  },
  additionalProperties: true,
  description: 'Workflow configuration — specify either reference or inline, not both',
};

/**
 * Schema for constraints configuration (maps to MissionConstraintsConfig in yaml.go)
 */
const constraintsSchema: JSONSchema7 = {
  type: 'object',
  additionalProperties: true,
  description: 'Execution constraints (validated by daemon)',
};

/**
 * Schema for guardrails configuration (maps to GuardrailConfig in yaml.go)
 */
const guardrailsSchema: JSONSchema7 = {
  type: 'object',
  additionalProperties: true,
  description: 'Safety guardrails configuration (validated by daemon)',
};

/**
 * Schema for reporting configuration (maps to ReportingConfig in yaml.go)
 */
const reportingSchema: JSONSchema7 = {
  type: 'object',
  additionalProperties: true,
  description: 'Reporting configuration (validated by daemon)',
};

// ============================================================================
// Main Mission Schema
// ============================================================================

/**
 * Complete JSON Schema for Gibson mission YAML.
 * Property names match Go YAML struct tags in core/gibson/internal/mission/yaml.go.
 */
export const missionSchema: JSONSchema7 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://gibson.security/schemas/mission.json',
  title: 'Gibson Mission',
  description: 'Schema for Gibson security mission configuration',
  type: 'object',
  properties: {
    // Metadata
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z][a-zA-Z0-9_\\- ]*$',
      description: 'Mission name (alphanumeric with spaces, dashes, underscores)',
    },
    description: {
      type: 'string',
      maxLength: 2000,
      description: 'Detailed description of the mission objectives',
    },

    // Core configuration
    target: targetSchema,
    workflow: workflowSchema,
    constraints: constraintsSchema,
    guardrails: guardrailsSchema,
    reporting: reportingSchema,
  },
  required: ['name'],
  additionalProperties: true,
};

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Get the schema for a specific field path
 */
export function getSchemaForPath(path: string): JSONSchema7 | null {
  const parts = path.split('.');
  let current: JSONSchema7 = missionSchema;

  for (const part of parts) {
    if (current.properties && current.properties[part]) {
      current = current.properties[part] as JSONSchema7;
    } else if (current.items) {
      current = current.items as JSONSchema7;
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Get field description for documentation
 */
export function getFieldDescription(path: string): string | null {
  const schema = getSchemaForPath(path);
  return schema?.description || null;
}

/**
 * Get required fields for a schema
 */
export function getRequiredFields(schema: JSONSchema7): string[] {
  return (schema.required as string[]) || [];
}

/**
 * Check if a field is required
 */
export function isFieldRequired(parentPath: string, fieldName: string): boolean {
  const parentSchema = parentPath ? getSchemaForPath(parentPath) : missionSchema;
  if (!parentSchema) return false;
  return ((parentSchema.required as string[]) || []).includes(fieldName);
}

/**
 * Get enum values for a field
 */
export function getEnumValues(path: string): string[] | null {
  const schema = getSchemaForPath(path);
  if (!schema || !schema.enum) return null;
  return schema.enum as string[];
}

/**
 * Get the default value for a field
 */
export function getDefaultValue(path: string): unknown {
  const schema = getSchemaForPath(path);
  return schema?.default;
}

// ============================================================================
// Export
// ============================================================================

export default missionSchema;

// Export sub-schemas for specific validation
export {
  targetSeedSchema,
  targetSchema,
  inlineTargetSchema,
  workflowSchema,
  workflowNodeSchema,
  workflowEdgeSchema,
  inlineWorkflowSchema,
  constraintsSchema,
  guardrailsSchema,
  reportingSchema,
};
