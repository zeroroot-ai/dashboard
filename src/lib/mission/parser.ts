/**
 * Mission YAML Parser and Transformer
 *
 * Bi-directional YAML/JSON transformation for visual builder sync.
 * Features:
 * - YAML to JSON parsing with error handling
 * - JSON to YAML serialization with formatting
 * - Bi-directional sync utilities
 * - Mission state extraction
 */

import YAML from 'yaml';
import type {
  MissionCreationState,
  MissionMetadata,
  ScopeConfig,
  ScopeTarget,
  ScopePattern,
  MissionConfig,
  MissionStep,
  MissionStepType,
  GuardrailsConfig,
  RateLimitConfig,
  ConfirmationRule,
  ScopeTargetType,
  ScopeExpansionMode,
  SeverityLevel,
  ReportFormat,
  MissionPriority,
} from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export interface MissionYAML {
  name: string;
  description?: string;
  tags?: string[];
  scope?: {
    seeds?: Array<string | { type: string; value: string }>;
    include?: Array<string | { type: string; pattern: string }>;
    exclude?: Array<string | { type: string; pattern: string }>;
    depth?: number;
    maxTargets?: number;
    followRedirects?: boolean;
    expansionMode?: string;
  };
  mission?: MissionYAMLBlock | Array<NonNullable<MissionYAMLBlock['steps']>[number]>;
  guardrails?: {
    maxTokens?: number;
    maxTokensPerCall?: number;
    maxTotalTokens?: number;
    maxFindings?: number;
    rateLimit?: { requestsPerMinute?: number };
    rateLimits?: Array<{
      target: string;
      type?: string;
      maxCalls: number;
      windowSeconds?: number;
    }>;
    allowedAgents?: string[];
    blockedAgents?: string[];
    blockedTools?: string[];
    requireConfirmation?: string[];
    sandboxMode?: boolean;
    enableCelGuardrails?: boolean;
    customGuardrails?: Array<{
      name: string;
      expression: string;
      action?: string;
      message?: string;
    }>;
  };
  reporting?: {
    formats?: string[];
    severityThreshold?: string;
  };
  priority?: string;
  maxDuration?: number;
  maxCost?: number;
}

export interface MissionYAMLBlock {
  type?: 'sequential' | 'parallel' | 'dag';
  steps?: Array<{
    id?: string;
    type?: string;
    agent?: string;
    tool?: string;
    name?: string;
    task?: string;
    parameters?: Record<string, unknown>;
    dependsOn?: string[];
    onSuccess?: string;
    onFailure?: string;
  }>;
  agents?: Array<{
    name: string;
    task: string;
  }>;
}

// ============================================================================
// YAML Parsing
// ============================================================================

/**
 * Parse YAML string to JSON object
 */
export function parseYAML<T = unknown>(yamlContent: string): ParseResult<T> {
  // Empty/whitespace-only content is valid YAML (null document). Skip the
  // early-exit so callers get {success: true, data: null} rather than an
  // error — an empty editor buffer is not a parse failure.
  try {
    const doc = YAML.parseDocument(yamlContent);

    // Check for parsing errors
    if (doc.errors.length > 0) {
      const firstError = doc.errors[0];
      return {
        success: false,
        error: {
          message: firstError.message,
          line: firstError.linePos?.[0]?.line,
          column: firstError.linePos?.[0]?.col,
        },
      };
    }

    const data = doc.toJSON() as T;
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse YAML';
    return {
      success: false,
      error: { message },
    };
  }
}

/**
 * Serialize JSON object to YAML string
 */
export function serializeYAML(data: unknown, options?: { indent?: number }): string {
  const doc = new YAML.Document(data);
  if (doc.directives) doc.directives.yaml.explicit = false;

  // The yaml library always appends a trailing newline. Strip it so callers
  // get a clean string (e.g. "{}" not "{}\n") and string equality assertions
  // behave predictably in tests.
  return doc.toString({
    indent: options?.indent ?? 2,
    lineWidth: 0, // Disable line wrapping
    minContentWidth: 0,
    singleQuote: false,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd();
}

// ============================================================================
// Mission State Extraction
// ============================================================================

/**
 * Extract mission metadata from parsed YAML
 */
export function extractMetadata(yaml: MissionYAML): Partial<MissionMetadata> {
  return {
    name: yaml.name || '',
    description: yaml.description || '',
    tags: yaml.tags || [],
    maxDuration: yaml.maxDuration || null,
    maxCost: yaml.maxCost || null,
    severityThreshold: (yaml.reporting?.severityThreshold as SeverityLevel | undefined) ?? null,
    reportFormats: (yaml.reporting?.formats as ReportFormat[] | undefined) ?? ['json'],
    priority: (yaml.priority as MissionPriority | undefined) ?? 'normal',
  };
}

/**
 * Extract scope configuration from parsed YAML
 */
export function extractScope(yaml: MissionYAML): Partial<ScopeConfig> {
  const scope = yaml.scope || {};
  const seeds: ScopeTarget[] = [];
  const include: ScopePattern[] = [];
  const exclude: ScopePattern[] = [];

  // Parse seeds
  if (scope.seeds) {
    for (const seed of scope.seeds) {
      if (typeof seed === 'string') {
        seeds.push({
          id: generateId(),
          type: detectTargetType(seed),
          value: seed,
          isValid: true,
        });
      } else if (typeof seed === 'object' && seed.value) {
        seeds.push({
          id: generateId(),
          type: (seed.type || 'url') as ScopeTargetType,
          value: seed.value,
          isValid: true,
        });
      }
    }
  }

  // Parse include patterns
  if (scope.include) {
    for (const pattern of scope.include) {
      if (typeof pattern === 'string') {
        include.push({ type: 'glob', pattern });
      } else if (typeof pattern === 'object' && pattern.pattern) {
        include.push({
          type: (pattern.type || 'glob') as 'glob' | 'regex' | 'cidr',
          pattern: pattern.pattern,
        });
      }
    }
  }

  // Parse exclude patterns
  if (scope.exclude) {
    for (const pattern of scope.exclude) {
      if (typeof pattern === 'string') {
        exclude.push({ type: 'glob', pattern });
      } else if (typeof pattern === 'object' && pattern.pattern) {
        exclude.push({
          type: (pattern.type || 'glob') as 'glob' | 'regex' | 'cidr',
          pattern: pattern.pattern,
        });
      }
    }
  }

  return {
    seeds,
    include,
    exclude,
    maxDepth: scope.depth ?? 3,
    followRedirects: scope.followRedirects ?? true,
    expansionMode: (scope.expansionMode || 'subdomain') as ScopeExpansionMode,
  };
}

/**
 * Extract mission configuration from parsed YAML
 */
export function extractMission(yaml: MissionYAML): Partial<MissionConfig> {
  const mission = yaml.mission;
  if (!mission) {
    return { type: 'inline', steps: [], executionMode: 'sequential', errorHandling: 'continue' };
  }

  const steps: MissionStep[] = [];

  // Handle bare array of steps — `mission:` followed directly by a list.
  if (Array.isArray(mission)) {
    for (const step of mission as Array<NonNullable<MissionYAMLBlock['steps']>[number]>) {
      const stepType: MissionStepType = (step.type as MissionStepType | undefined) || (step.agent ? 'agent' : step.tool ? 'tool' : 'agent');
      steps.push({
        id: step.id || generateId(),
        type: stepType,
        name: step.name || step.agent || step.tool || 'Step',
        config: {
          type: 'agent',
          agentId: step.agent || '',
          task: step.task || '',
          parameters: step.parameters,
        },
        dependsOn: step.dependsOn || [],
      });
    }
    return { type: 'inline', steps, executionMode: 'sequential', errorHandling: 'continue' };
  }

  // Handle sequential steps array
  if (mission.steps) {
    for (const step of mission.steps) {
      const stepType: MissionStepType = (step.type as MissionStepType | undefined) || (step.agent ? 'agent' : step.tool ? 'tool' : 'agent');
      steps.push({
        id: step.id || generateId(),
        type: stepType,
        name: step.name || step.agent || step.tool || 'Step',
        config: {
          type: 'agent',
          agentId: step.agent || '',
          task: step.task || '',
          parameters: step.parameters,
        },
        dependsOn: step.dependsOn || [],
      });
    }
  }

  // Handle parallel agents array
  if (mission.agents) {
    for (const agent of mission.agents) {
      steps.push({
        id: generateId(),
        type: 'agent',
        name: agent.name,
        config: {
          type: 'agent',
          agentId: agent.name,
          task: agent.task,
        },
        dependsOn: [],
      });
    }
  }

  return {
    type: 'inline',
    steps,
    executionMode: mission.type || 'sequential',
    errorHandling: 'continue',
  };
}

/**
 * Extract guardrails configuration from parsed YAML
 */
export function extractGuardrails(yaml: MissionYAML): Partial<GuardrailsConfig> {
  const guardrails = yaml.guardrails || {};
  const rateLimits: RateLimitConfig[] = [];
  const confirmationRequired: ConfirmationRule[] = [];

  // Parse rate limits
  if (guardrails.rateLimit?.requestsPerMinute) {
    rateLimits.push({
      targetId: '*',
      targetType: 'agent',
      maxCalls: guardrails.rateLimit.requestsPerMinute,
      windowSeconds: 60,
    });
  }

  if (guardrails.rateLimits) {
    for (const limit of guardrails.rateLimits) {
      rateLimits.push({
        targetId: limit.target,
        targetType: (limit.type || 'agent') as 'tool' | 'agent',
        maxCalls: limit.maxCalls,
        windowSeconds: limit.windowSeconds || 60,
      });
    }
  }

  // Parse confirmation requirements
  if (guardrails.requireConfirmation) {
    for (const action of guardrails.requireConfirmation) {
      confirmationRequired.push({
        action,
        message: `Confirm ${action} action?`,
      });
    }
  }

  return {
    maxTokensPerCall: guardrails.maxTokensPerCall || null,
    maxTotalTokens: guardrails.maxTotalTokens || guardrails.maxTokens || null,
    maxFindings: guardrails.maxFindings || null,
    rateLimits,
    allowedAgents: guardrails.allowedAgents || [],
    blockedAgents: guardrails.blockedAgents || [],
    confirmationRequired,
    enableCelGuardrails: guardrails.enableCelGuardrails ?? true,
    customGuardrails: (guardrails.customGuardrails || []).map((g) => ({
      name: g.name,
      expression: g.expression,
      action: (g.action || 'block') as 'block' | 'warn' | 'log',
      message: g.message || '',
    })),
  };
}

// ============================================================================
// Mission State Serialization
// ============================================================================

/**
 * Build YAML object from mission creation state
 */
export function buildMissionYAML(state: Partial<MissionCreationState>): MissionYAML {
  const yaml: MissionYAML = {
    name: state.metadata?.name || 'my-mission',
  };

  // Add description
  if (state.metadata?.description) {
    yaml.description = state.metadata.description;
  }

  // Add tags
  if (state.metadata?.tags && state.metadata.tags.length > 0) {
    yaml.tags = state.metadata.tags;
  }

  // Add scope
  if (state.scope) {
    yaml.scope = buildScopeYAML(state.scope);
  }

  // Add mission steps
  if (state.mission && state.mission.steps.length > 0) {
    yaml.mission = buildMissionYAMLBlock(state.mission);
  }

  // Add guardrails
  if (state.guardrails) {
    const guardrailsYAML = buildGuardrailsYAML(state.guardrails);
    if (Object.keys(guardrailsYAML).length > 0) {
      yaml.guardrails = guardrailsYAML;
    }
  }

  // Add reporting
  if (state.metadata?.reportFormats || state.metadata?.severityThreshold) {
    yaml.reporting = {
      formats: state.metadata.reportFormats || ['json'],
      severityThreshold: state.metadata.severityThreshold || undefined,
    };
  }

  // Add priority
  if (state.metadata?.priority && state.metadata.priority !== 'normal') {
    yaml.priority = state.metadata.priority;
  }

  // Add limits
  if (state.metadata?.maxDuration) {
    yaml.maxDuration = state.metadata.maxDuration;
  }
  if (state.metadata?.maxCost) {
    yaml.maxCost = state.metadata.maxCost;
  }

  return yaml;
}

/**
 * Build scope section of YAML
 */
function buildScopeYAML(scope: ScopeConfig): MissionYAML['scope'] {
  const result: MissionYAML['scope'] = {};

  // Seeds
  if (scope.seeds.length > 0) {
    result.seeds = scope.seeds.map((seed) => {
      if (seed.type === 'url') {
        return seed.value;
      }
      return { type: seed.type, value: seed.value };
    });
  }

  // Include patterns
  if (scope.include.length > 0) {
    result.include = scope.include.map((p) => {
      if (p.type === 'glob') {
        return p.pattern;
      }
      return { type: p.type, pattern: p.pattern };
    });
  }

  // Exclude patterns
  if (scope.exclude.length > 0) {
    result.exclude = scope.exclude.map((p) => {
      if (p.type === 'glob') {
        return p.pattern;
      }
      return { type: p.type, pattern: p.pattern };
    });
  }

  // Other settings
  if (scope.maxDepth !== 3) {
    result.depth = scope.maxDepth;
  }
  if (scope.followRedirects === false) {
    result.followRedirects = false;
  }
  if (scope.expansionMode !== 'subdomain') {
    result.expansionMode = scope.expansionMode;
  }

  return result;
}

/**
 * Build mission section of YAML
 */
function buildMissionYAMLBlock(mission: MissionConfig): MissionYAMLBlock {
  const result: MissionYAMLBlock = {};

  if (mission.executionMode !== 'sequential') {
    result.type = mission.executionMode;
  }

  if (mission.steps.length > 0) {
    result.steps = mission.steps.map((step) => {
      const stepYAML: NonNullable<MissionYAMLBlock['steps']>[number] & Record<string, unknown> = {};

      if (step.id) {
        stepYAML.id = step.id;
      }

      if (step.type === 'agent' && step.config.type === 'agent') {
        const config = step.config;
        stepYAML.agent = config.agentId;
        stepYAML.task = config.task;
        if (config.parameters && Object.keys(config.parameters).length > 0) {
          stepYAML.parameters = config.parameters;
        }
      } else if (step.type === 'tool' && step.config.type === 'tool') {
        const config = step.config;
        stepYAML.type = 'tool';
        stepYAML.tool = config.toolId;
        (stepYAML as Record<string, unknown>).parameters = config.inputs;
      } else {
        stepYAML.type = step.type;
        stepYAML.name = step.name;
      }

      if (step.dependsOn && step.dependsOn.length > 0) {
        stepYAML.dependsOn = step.dependsOn;
      }

      return stepYAML;
    });
  }

  return result;
}

/**
 * Build guardrails section of YAML
 */
function buildGuardrailsYAML(guardrails: GuardrailsConfig): NonNullable<MissionYAML['guardrails']> {
  const result: NonNullable<MissionYAML['guardrails']> = {};

  if (guardrails.maxTokensPerCall) {
    result.maxTokensPerCall = guardrails.maxTokensPerCall;
  }
  if (guardrails.maxTotalTokens) {
    result.maxTotalTokens = guardrails.maxTotalTokens;
  }
  if (guardrails.maxFindings) {
    result.maxFindings = guardrails.maxFindings;
  }

  const rateLimits = guardrails.rateLimits;
  if (Array.isArray(rateLimits) && rateLimits.length > 0) {
    // Convert to simple format if single rate limit
    if (rateLimits.length === 1 && rateLimits[0].targetId === '*') {
      result.rateLimit = { requestsPerMinute: rateLimits[0].maxCalls };
    } else {
      result.rateLimits = rateLimits.map((r: import('@/src/types/mission-creation').RateLimitConfig) => ({
        target: r.targetId,
        type: r.targetType,
        maxCalls: r.maxCalls,
        windowSeconds: r.windowSeconds,
      }));
    }
  }

  if (guardrails.allowedAgents.length > 0) {
    result.allowedAgents = guardrails.allowedAgents;
  }
  if (guardrails.blockedAgents.length > 0) {
    result.blockedAgents = guardrails.blockedAgents;
  }

  if (guardrails.confirmationRequired.length > 0) {
    result.requireConfirmation = guardrails.confirmationRequired.map((c) => c.action);
  }

  if (guardrails.enableCelGuardrails === false) {
    result.enableCelGuardrails = false;
  }

  if (guardrails.customGuardrails.length > 0) {
    result.customGuardrails = guardrails.customGuardrails;
  }

  return result;
}

// ============================================================================
// Bi-directional Sync
// ============================================================================

/**
 * Sync YAML content to mission creation state
 */
export function yamlToState(yamlContent: string): ParseResult<Partial<MissionCreationState>> {
  const parseResult = parseYAML<MissionYAML>(yamlContent);

  if (!parseResult.success || !parseResult.data) {
    return parseResult as ParseResult<Partial<MissionCreationState>>;
  }

  const yaml = parseResult.data;

  try {
    // The extract* helpers return Partial<X> but the state requires full X —
    // YAML may omit fields that have defaults; callers must fill gaps before
    // submission. The casts suppress the TS structural mismatch without
    // hiding the intent of the partial extraction.
    const state: Partial<MissionCreationState> = {
      yamlContent,
      metadata: extractMetadata(yaml) as unknown as MissionMetadata,
      scope: extractScope(yaml) as unknown as ScopeConfig,
      mission: extractMission(yaml) as unknown as MissionConfig,
      guardrails: extractGuardrails(yaml) as unknown as GuardrailsConfig,
    };

    return { success: true, data: state };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to extract state from YAML',
      },
    };
  }
}

/**
 * Sync mission creation state to YAML content
 */
export function stateToYAML(state: Partial<MissionCreationState>): string {
  const yaml = buildMissionYAML(state);
  return serializeYAML(yaml);
}

/**
 * Result of merging changes into YAML.
 */
export interface MergeChangesResult {
  success: boolean;
  yaml?: string;
  error?: string;
}

/**
 * Merge visual builder changes into existing YAML
 * Preserves formatting and comments where possible
 */
export function mergeChangesIntoYAML(
  originalYAML: string,
  changes: Record<string, unknown>
): MergeChangesResult {
  const parseResult = parseYAML<MissionYAML>(originalYAML);

  if (!parseResult.success || !parseResult.data) {
    return {
      success: false,
      error: parseResult.error?.message ?? 'Failed to parse YAML',
    };
  }

  try {
    const existingYAML = parseResult.data;
    // Deep merge changes into existing YAML structure
    const merged: MissionYAML = deepMerge(existingYAML as unknown as Record<string, unknown>, changes) as unknown as MissionYAML;
    return { success: true, yaml: serializeYAML(merged) };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to merge changes',
    };
  }
}

/**
 * Simple deep merge utility
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Detect target type from value
 */
function detectTargetType(value: string): ScopeTargetType {
  // Check for URL
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return 'url';
  }

  // Check for CIDR
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(value)) {
    return 'cidr';
  }

  // Check for IP
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
    return 'ip';
  }

  // Check for repository URLs
  if (value.includes('github.com') || value.includes('gitlab.com') || value.includes('bitbucket.org')) {
    return 'repository';
  }

  // Default to domain
  return 'domain';
}

// ============================================================================
/**
 * Extract a specific section from a YAML string by key name.
 *
 * @param yamlContent - The raw YAML string
 * @param sectionKey - The top-level key to extract
 * @returns The section value or undefined if not present
 */
export function extractYAMLSection(
  yamlContent: string,
  sectionKey: string
): Record<string, unknown> | undefined {
  const result = parseYAML<Record<string, unknown>>(yamlContent);
  if (!result.success || !result.data) return undefined;
  const section = result.data[sectionKey];
  if (section === null || section === undefined) return undefined;
  if (typeof section !== 'object' || Array.isArray(section)) return undefined;
  return section as Record<string, unknown>;
}

// Export
// ============================================================================

export default {
  parseYAML,
  serializeYAML,
  extractMetadata,
  extractScope,
  extractMission,
  extractGuardrails,
  buildMissionYAML,
  yamlToState,
  stateToYAML,
  mergeChangesIntoYAML,
};
