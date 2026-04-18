/**
 * Mission YAML JSON Schema
 *
 * Comprehensive JSON Schema (draft-07) for validating Gibson mission YAML files.
 * This is an authoring-side validator used by the Monaco editor; the YAML is
 * parsed client-side into a structured MissionDefinition proto before being
 * sent to the daemon. The property names here describe the dashboard's YAML
 * authoring surface (see src/lib/mission/parser.ts + mission-serializer.ts).
 * Sections covered:
 * - Mission metadata (name, description)
 * - Target configuration (reference or inline seeds)
 * - Mission definition (reference or inline nodes/edges)
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
 * Schema for the client-side authored target block embedded in a mission YAML.
 * This is a dashboard-only authoring convenience — the daemon API is reference-only
 * (target_id + mission_definition_id). Before submit, the UI parses this YAML
 * client-side and produces a MissionDefinition proto via mission-serializer.ts.
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
 * Schema for a mission edge (dashboard authoring form of MissionEdge).
 */
const missionEdgeSchema: JSONSchema7 = {
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
 * Schema for a mission node (dashboard authoring form of MissionNode).
 */
const missionNodeSchema: JSONSchema7 = {
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
 * Schema for an inline mission definition (dashboard authoring form).
 */
const inlineMissionSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Optional name for this inline mission definition',
    },
    nodes: {
      type: 'array',
      items: missionNodeSchema,
      minItems: 1,
      description: 'Mission nodes to execute',
    },
    edges: {
      type: 'array',
      items: missionEdgeSchema,
      description: 'Directed edges defining execution order (DAG)',
    },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Optional metadata for the mission',
    },
  },
  required: ['nodes'],
  additionalProperties: true,
};

/**
 * Schema for the mission step graph (dashboard authoring form).
 */
const missionSectionSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    reference: {
      type: 'string',
      minLength: 1,
      description: 'Reference to an existing mission definition by name or ID',
    },
    inline: {
      ...inlineMissionSchema,
      description: 'Inline mission definition',
    },
  },
  additionalProperties: true,
  description: 'Mission step graph — specify either reference or inline, not both',
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
    mission: missionSectionSchema,
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
  missionSectionSchema,
  missionNodeSchema,
  missionEdgeSchema,
  inlineMissionSchema,
  constraintsSchema,
  guardrailsSchema,
  reportingSchema,
};
