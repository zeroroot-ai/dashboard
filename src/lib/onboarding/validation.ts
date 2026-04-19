/**
 * Onboarding Validation Utilities
 *
 * Input validation for the onboarding wizard using
 * pattern-based validation with provider-specific rules.
 */

import type { LLMProviderType as LLMProvider, ValidationResult } from '@/src/types/onboarding';

// ============================================================================
// Types
// ============================================================================

export interface ValidationRule {
  /** Rule identifier */
  id: string;
  /** Validation function */
  validate: (value: string) => boolean;
  /** Error message if validation fails */
  message: string;
}

export interface FieldValidation {
  /** Field identifier */
  field: string;
  /** Validation rules to apply */
  rules: ValidationRule[];
}

// ============================================================================
// Common Validation Rules
// ============================================================================

export const VALIDATION_RULES = {
  required: (message = 'This field is required'): ValidationRule => ({
    id: 'required',
    validate: (value) => value.trim().length > 0,
    message,
  }),

  minLength: (min: number, message?: string): ValidationRule => ({
    id: `minLength:${min}`,
    validate: (value) => value.length >= min,
    message: message || `Must be at least ${min} characters`,
  }),

  maxLength: (max: number, message?: string): ValidationRule => ({
    id: `maxLength:${max}`,
    validate: (value) => value.length <= max,
    message: message || `Must be at most ${max} characters`,
  }),

  pattern: (regex: RegExp, message: string): ValidationRule => ({
    id: `pattern:${regex.source}`,
    validate: (value) => regex.test(value),
    message,
  }),

  url: (message = 'Please enter a valid URL'): ValidationRule => ({
    id: 'url',
    validate: (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    message,
  }),

  email: (message = 'Please enter a valid email'): ValidationRule => ({
    id: 'email',
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message,
  }),

  numeric: (message = 'Please enter a number'): ValidationRule => ({
    id: 'numeric',
    validate: (value) => /^\d+$/.test(value),
    message,
  }),

  alphanumeric: (message = 'Only letters and numbers allowed'): ValidationRule => ({
    id: 'alphanumeric',
    validate: (value) => /^[a-zA-Z0-9]+$/.test(value),
    message,
  }),
};

// ============================================================================
// Provider-Specific API Key Validation
// ============================================================================

/**
 * API key format patterns by provider
 */
export const API_KEY_PATTERNS: Record<LLMProvider, RegExp> = {
  anthropic: /^sk-ant-[a-zA-Z0-9_-]{40,}$/,
  openai: /^sk-[a-zA-Z0-9]{32,}$/,
  google: /^AIza[a-zA-Z0-9_-]{35}$/,
  ollama: /^.+$/, // Ollama uses base URL, any non-empty string
};

/**
 * API key format descriptions by provider
 */
export const API_KEY_DESCRIPTIONS: Record<LLMProvider, string> = {
  anthropic: 'Should start with "sk-ant-" followed by alphanumeric characters',
  openai: 'Should start with "sk-" followed by alphanumeric characters',
  google: 'Should start with "AIza" followed by alphanumeric characters',
  ollama: 'Enter your Ollama server URL (e.g., http://localhost:11434)',
};

/**
 * Validate API key format for a specific provider
 */
export function validateApiKeyFormat(
  provider: LLMProvider,
  apiKey: string
): ValidationResult {
  if (!apiKey.trim()) {
    return {
      valid: false,
      error: 'API key is required',
    };
  }

  const pattern = API_KEY_PATTERNS[provider];
  const isValid = pattern.test(apiKey);

  if (!isValid) {
    return {
      valid: false,
      error: `Invalid ${provider} API key format. ${API_KEY_DESCRIPTIONS[provider]}`,
    };
  }

  return { valid: true };
}

/**
 * Validate API key format.
 *
 * NOTE: Spec 25 removed the live-call validation path (`/api/onboarding/validate-llm`)
 * in favour of the daemon's `TestProvider` RPC, which is invoked from the
 * Settings > Providers form on save. Onboarding's job is reduced to
 * format-checking the credential before the user submits; the daemon does
 * the real network check and returns structured errors through the CRUD
 * flow. Callers that still need a live test should use the `testProvider`
 * gibson-client helper against the daemon.
 */
export async function validateApiKey(
  provider: LLMProvider,
  apiKey: string
): Promise<ValidationResult> {
  return validateApiKeyFormat(provider, apiKey);
}

// ============================================================================
// Field Validators
// ============================================================================

/**
 * Validate a single field value
 */
export function validateField(
  value: string,
  rules: ValidationRule[]
): ValidationResult {
  for (const rule of rules) {
    if (!rule.validate(value)) {
      return {
        valid: false,
        error: rule.message,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate multiple fields
 */
export function validateFields(
  values: Record<string, string>,
  validations: FieldValidation[]
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  for (const validation of validations) {
    const value = values[validation.field] || '';
    results[validation.field] = validateField(value, validation.rules);
  }

  return results;
}

/**
 * Check if all fields are valid
 */
export function allFieldsValid(
  results: Record<string, ValidationResult>
): boolean {
  return Object.values(results).every((r) => r.valid);
}

// ============================================================================
// Wizard Step Validation
// ============================================================================

/**
 * Step validation configurations
 */
export const STEP_VALIDATIONS: Record<string, FieldValidation[]> = {
  welcome: [], // No validation needed

  'llm-provider': [
    {
      field: 'provider',
      rules: [VALIDATION_RULES.required('Please select an LLM provider')],
    },
    {
      field: 'apiKey',
      rules: [
        VALIDATION_RULES.required('API key is required'),
        VALIDATION_RULES.minLength(10, 'API key is too short'),
      ],
    },
  ],

  'agent-selection': [
    {
      field: 'agentId',
      rules: [VALIDATION_RULES.required('Please select an agent')],
    },
  ],

  'mission-creation': [
    {
      field: 'templateId',
      rules: [VALIDATION_RULES.required('Please select a mission template')],
    },
  ],

  completion: [], // No validation needed
};

/**
 * Validate a wizard step
 */
export function validateStep(
  stepId: string,
  values: Record<string, string>
): Record<string, ValidationResult> {
  const validations = STEP_VALIDATIONS[stepId] || [];
  return validateFields(values, validations);
}

/**
 * Check if a step is complete and valid
 */
export function isStepValid(
  stepId: string,
  values: Record<string, string>
): boolean {
  const results = validateStep(stepId, values);
  return allFieldsValid(results);
}

// ============================================================================
// Target Validation
// ============================================================================

/**
 * Validate domain name
 */
export function validateDomain(domain: string): ValidationResult {
  if (!domain.trim()) {
    return { valid: false, error: 'Domain is required' };
  }

  const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, error: 'Please enter a valid domain (e.g., example.com)' };
  }

  return { valid: true };
}

/**
 * Validate IP address
 */
export function validateIpAddress(ip: string): ValidationResult {
  if (!ip.trim()) {
    return { valid: false, error: 'IP address is required' };
  }

  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.every((p) => p >= 0 && p <= 255)) {
      return { valid: true };
    }
  }

  // IPv6 (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  if (ipv6Regex.test(ip)) {
    return { valid: true };
  }

  return { valid: false, error: 'Please enter a valid IP address' };
}

/**
 * Validate CIDR notation
 */
export function validateCidr(cidr: string): ValidationResult {
  if (!cidr.trim()) {
    return { valid: false, error: 'CIDR range is required' };
  }

  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) {
    return { valid: false, error: 'Please enter a valid CIDR (e.g., 192.168.1.0/24)' };
  }

  const [ip, prefix] = cidr.split('/');
  const prefixNum = parseInt(prefix, 10);

  const ipResult = validateIpAddress(ip);
  if (!ipResult.valid) {
    return ipResult;
  }

  if (prefixNum < 0 || prefixNum > 32) {
    return { valid: false, error: 'Prefix must be between 0 and 32' };
  }

  return { valid: true };
}

/**
 * Validate port number
 */
export function validatePort(port: string | number): ValidationResult {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (isNaN(portNum)) {
    return { valid: false, error: 'Please enter a valid port number' };
  }

  if (portNum < 1 || portNum > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }

  return { valid: true };
}

/**
 * Validate URL
 */
export function validateUrl(url: string): ValidationResult {
  if (!url.trim()) {
    return { valid: false, error: 'URL is required' };
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http or https protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Please enter a valid URL' };
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  VALIDATION_RULES,
  API_KEY_PATTERNS,
  API_KEY_DESCRIPTIONS,
  validateApiKeyFormat,
  validateApiKey,
  validateField,
  validateFields,
  allFieldsValid,
  validateStep,
  isStepValid,
  validateDomain,
  validateIpAddress,
  validateCidr,
  validatePort,
  validateUrl,
};
