/**
 * Mission YAML Validation Utilities
 *
 * Provides client-side and server-side validation for Gibson mission YAML files.
 * Features:
 * - YAML parsing with error handling and line number tracking
 * - JSON Schema validation using Ajv
 * - Custom validation rules for mission-specific logic
 * - Error formatting with actionable messages
 */

import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { missionSchema } from './yaml-schema';
import type { ValidationError, ValidationWarning } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  /** Whether the YAML is valid */
  isValid: boolean;
  /** Validation errors (must be fixed) */
  errors: ValidationError[];
  /** Validation warnings (suggestions) */
  warnings: ValidationWarning[];
  /** Parsed mission object (if parsing succeeded) */
  parsed: Record<string, unknown> | null;
  /** Validation duration in ms */
  duration: number;
}

export interface ParseResult {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed object */
  data: Record<string, unknown> | null;
  /** Parse error if failed */
  error: ValidationError | null;
}

// ============================================================================
// Ajv Setup
// ============================================================================

// Create Ajv instance with all options
const ajv = new Ajv({
  allErrors: true, // Collect all errors, not just the first one
  verbose: true, // Include data in errors for better messages
  strict: false, // Allow additional keywords
  validateFormats: true,
});

// Add format validation (uri, email, etc.)
addFormats(ajv);

// Compile the mission schema
const validateMissionSchema = ajv.compile(missionSchema);

// ============================================================================
// YAML Parsing
// ============================================================================

/**
 * Parse YAML string to object with error handling
 */
export function parseYAML(yamlContent: string): ParseResult {
  try {
    const data = parseYaml(yamlContent, {
      prettyErrors: true,
      strict: true,
    });

    // Check for empty content
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        data: null,
        error: {
          code: 'YAML_EMPTY',
          message: 'YAML content is empty or not an object',
          path: '',
          line: 1,
          column: 1,
          severity: 'error',
        },
      };
    }

    return {
      success: true,
      data: data as Record<string, unknown>,
      error: null,
    };
  } catch (error) {
    if (error instanceof YAMLParseError) {
      // Extract line and column from YAML error
      const lineMatch = error.message.match(/at line (\d+)/);
      const columnMatch = error.message.match(/column (\d+)/);

      return {
        success: false,
        data: null,
        error: {
          code: 'YAML_PARSE_ERROR',
          message: formatYAMLError(error.message),
          path: '',
          line: lineMatch ? parseInt(lineMatch[1], 10) : 1,
          column: columnMatch ? parseInt(columnMatch[1], 10) : 1,
          severity: 'error',
        },
      };
    }

    return {
      success: false,
      data: null,
      error: {
        code: 'YAML_UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown parsing error',
        path: '',
        line: 1,
        column: 1,
        severity: 'error',
      },
    };
  }
}

/**
 * Format YAML error message for display
 */
function formatYAMLError(message: string): string {
  // Clean up common YAML error messages
  const cleanups: Array<[RegExp, string]> = [
    [/^YAMLParseError:\s*/, ''],
    [/at line \d+, column \d+:?\s*/, ''],
    [/Implicit keys need to be on a single line$/, 'Invalid YAML syntax: check indentation'],
    [/Map keys must be unique$/, 'Duplicate key found'],
    [/Block scalars with more-indented leading empty lines must use an explicit indentation indicator$/,
      'Invalid indentation in multi-line string'],
  ];

  let result = message;
  for (const [pattern, replacement] of cleanups) {
    result = result.replace(pattern, replacement);
  }

  return result.trim() || 'Invalid YAML syntax';
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validate parsed mission against JSON Schema
 */
export function validateSchema(
  data: Record<string, unknown>
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const valid = validateMissionSchema(data);

  if (!valid && validateMissionSchema.errors) {
    for (const error of validateMissionSchema.errors) {
      const formatted = formatSchemaError(error);
      if (formatted) {
        errors.push(formatted);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Format Ajv error to ValidationError
 */
function formatSchemaError(error: ErrorObject): ValidationError | null {
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.');

  let message: string;
  let code: string;

  switch (error.keyword) {
    case 'required':
      message = `Missing required field: ${error.params.missingProperty}`;
      code = 'REQUIRED_FIELD';
      break;

    case 'type':
      message = `Expected ${error.params.type}, got ${typeof error.data}`;
      code = 'INVALID_TYPE';
      break;

    case 'enum':
      message = `Invalid value. Allowed values: ${(error.params.allowedValues as string[]).join(', ')}`;
      code = 'INVALID_ENUM';
      break;

    case 'pattern':
      message = `Value does not match required pattern`;
      code = 'INVALID_PATTERN';
      break;

    case 'minLength':
      message = `Value is too short (minimum ${error.params.limit} characters)`;
      code = 'TOO_SHORT';
      break;

    case 'maxLength':
      message = `Value is too long (maximum ${error.params.limit} characters)`;
      code = 'TOO_LONG';
      break;

    case 'minimum':
      message = `Value must be at least ${error.params.limit}`;
      code = 'TOO_SMALL';
      break;

    case 'maximum':
      message = `Value must be at most ${error.params.limit}`;
      code = 'TOO_LARGE';
      break;

    case 'minItems':
      message = `Array must have at least ${error.params.limit} items`;
      code = 'TOO_FEW_ITEMS';
      break;

    case 'maxItems':
      message = `Array can have at most ${error.params.limit} items`;
      code = 'TOO_MANY_ITEMS';
      break;

    case 'additionalProperties':
      message = `Unknown property: ${error.params.additionalProperty}`;
      code = 'UNKNOWN_PROPERTY';
      break;

    case 'oneOf':
    case 'anyOf':
      message = `Value does not match any allowed schema`;
      code = 'SCHEMA_MISMATCH';
      break;

    default:
      message = error.message || 'Validation error';
      code = 'VALIDATION_ERROR';
  }

  return {
    code,
    message,
    path: path || error.params?.missingProperty || '',
    severity: 'error',
    // Line numbers would require source mapping which we'll add later
  };
}

// ============================================================================
// Custom Validation Rules
// ============================================================================

/**
 * Run custom validation rules
 */
export function validateCustomRules(
  data: Record<string, unknown>
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for empty scope seeds
  const scope = data.scope as Record<string, unknown> | undefined;
  if (scope?.seeds) {
    const seeds = scope.seeds as unknown[];
    if (seeds.length === 0) {
      errors.push({
        code: 'EMPTY_SCOPE',
        message: 'At least one scope target is required',
        path: 'scope.seeds',
        severity: 'error',
      });
    }
  }

  // Check for mission DAG consistency
  const mission = data.mission as Record<string, unknown> | undefined;
  if (mission?.type === 'dag' && !mission.entrypoint) {
    errors.push({
      code: 'MISSING_ENTRYPOINT',
      message: 'DAG mission requires an entrypoint step',
      path: 'mission.entrypoint',
      severity: 'error',
    });
  }

  // Warn about missing guardrails
  if (!data.guardrails) {
    warnings.push({
      code: 'NO_GUARDRAILS',
      message: 'Consider adding guardrails for safety (rate limits, allowed agents)',
      path: 'guardrails',
      severity: 'warning',
      suggestion: 'Add a guardrails section to limit token usage and API calls',
    });
  }

  // Warn about missing description
  if (!data.description) {
    warnings.push({
      code: 'NO_DESCRIPTION',
      message: 'Consider adding a description for better documentation',
      path: 'description',
      severity: 'warning',
    });
  }

  // Warn about high token limits
  const guardrails = data.guardrails as Record<string, unknown> | undefined;
  if (guardrails?.maxTokens && (guardrails.maxTokens as number) > 1000000) {
    warnings.push({
      code: 'HIGH_TOKEN_LIMIT',
      message: 'Token limit is very high. Consider reducing for cost control.',
      path: 'guardrails.maxTokens',
      severity: 'warning',
    });
  }

  // Validate step references in the mission graph
  if (mission?.steps) {
    const steps = mission.steps as Array<Record<string, unknown>>;
    const stepIds = new Set(steps.map(s => s.id as string));

    for (const step of steps) {
      // Check onSuccess reference
      if (step.onSuccess && !stepIds.has(step.onSuccess as string)) {
        errors.push({
          code: 'INVALID_STEP_REF',
          message: `Step "${step.id}" references unknown step "${step.onSuccess}" in onSuccess`,
          path: `mission.steps.${step.id}.onSuccess`,
          severity: 'error',
        });
      }

      // Check onFailure reference
      if (step.onFailure && !stepIds.has(step.onFailure as string)) {
        errors.push({
          code: 'INVALID_STEP_REF',
          message: `Step "${step.id}" references unknown step "${step.onFailure}" in onFailure`,
          path: `mission.steps.${step.id}.onFailure`,
          severity: 'error',
        });
      }

      // Check parallel branches
      if (step.branches) {
        const branches = step.branches as string[];
        for (const branch of branches) {
          if (!stepIds.has(branch)) {
            errors.push({
              code: 'INVALID_BRANCH_REF',
              message: `Parallel step "${step.id}" references unknown branch "${branch}"`,
              path: `mission.steps.${step.id}.branches`,
              severity: 'error',
            });
          }
        }
      }
    }
  }

  return { errors, warnings };
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate mission YAML content
 *
 * Performs complete validation:
 * 1. YAML syntax parsing
 * 2. JSON Schema validation
 * 3. Custom business rules
 *
 * @param yamlContent - Raw YAML string to validate
 * @returns ValidationResult with errors, warnings, and parsed data
 */
export function validateMissionYAML(yamlContent: string): ValidationResult {
  const startTime = performance.now();
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Handle empty content
  if (!yamlContent.trim()) {
    return {
      isValid: false,
      errors: [{
        code: 'EMPTY_CONTENT',
        message: 'Mission YAML cannot be empty',
        path: '',
        line: 1,
        column: 1,
        severity: 'error',
      }],
      warnings: [],
      parsed: null,
      duration: performance.now() - startTime,
    };
  }

  // Step 1: Parse YAML
  const parseResult = parseYAML(yamlContent);
  if (!parseResult.success) {
    return {
      isValid: false,
      errors: parseResult.error ? [parseResult.error] : [],
      warnings: [],
      parsed: null,
      duration: performance.now() - startTime,
    };
  }

  // Step 2: Schema validation
  const schemaResult = validateSchema(parseResult.data!);
  errors.push(...schemaResult.errors);
  warnings.push(...schemaResult.warnings);

  // Step 3: Custom rules (only if schema passes)
  if (schemaResult.errors.length === 0) {
    const customResult = validateCustomRules(parseResult.data!);
    errors.push(...customResult.errors);
    warnings.push(...customResult.warnings);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    parsed: parseResult.data,
    duration: performance.now() - startTime,
  };
}

// ============================================================================
// Line Number Mapping
// ============================================================================

/**
 * Find line number for a YAML path
 *
 * This is a basic implementation - a more robust version would use
 * the YAML AST for precise line mapping.
 */
export function findLineForPath(yamlContent: string, path: string): number | null {
  const lines = yamlContent.split('\n');
  const pathParts = path.split('.');

  let currentIndent = 0;
  let searchKey = pathParts[0];
  let pathIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed.length === 0) {
      continue;
    }

    // Check if this line has the key we're looking for
    if (trimmed.startsWith(`${searchKey}:`)) {
      pathIndex++;
      if (pathIndex >= pathParts.length) {
        return i + 1; // Line numbers are 1-based
      }
      searchKey = pathParts[pathIndex];
      currentIndent = indent;
    }
  }

  return null;
}

/**
 * Add line numbers to validation errors
 */
export function addLineNumbers(
  yamlContent: string,
  errors: ValidationError[]
): ValidationError[] {
  return errors.map(error => {
    if (error.line) return error;

    const line = error.path ? findLineForPath(yamlContent, error.path) : null;
    return line ? { ...error, line } : error;
  });
}

// ============================================================================
// Export
// ============================================================================

export default validateMissionYAML;
