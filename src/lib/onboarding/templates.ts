/**
 * Template Loading Utilities
 *
 * Handles loading, parsing, and rendering mission templates
 * with variable substitution and prerequisite checking.
 */

import type {
  MissionTemplate,
  MissionTemplateListItem,
  TemplateCustomValues,
  TemplateRenderResult,
  TemplateValidationError,
  CustomizableField,
  TemplateFilters,
  TemplateSort,
  TemplateCategory,
  TemplateDifficulty,
} from '@/src/types/templates';

// ============================================================================
// Built-in Templates (for onboarding)
// ============================================================================

/**
 * Built-in starter templates for onboarding.
 * These are embedded in the application for zero-configuration start.
 */
export const BUILTIN_TEMPLATES: MissionTemplate[] = [
  {
    id: 'hello-gibson',
    name: 'Hello Zero Day AI',
    description: 'Your first mission - learn the basics of Zero Day AI',
    longDescription: `
# Hello Zero Day AI

This introductory mission teaches you the fundamentals of Zero Day AI:
- How missions execute
- How agents make decisions
- How findings are reported

Perfect for first-time users.
    `.trim(),
    version: '1.0.0',
    category: 'reconnaissance',
    difficulty: 'beginner',
    tags: ['tutorial', 'getting-started', 'beginner'],
    author: 'Zero Day AI Team',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    prerequisites: [
      {
        id: 'llm-provider',
        type: 'llm_provider',
        name: 'LLM Provider',
        description: 'An LLM provider must be configured',
        requirement: 'any',
        required: true,
        helpUrl: '/settings/llm',
      },
    ],
    estimatedRuntime: '1-2 minutes',
    expectedOutcomes: [
      'Understand mission execution flow',
      'See agent reasoning in action',
      'View sample findings',
    ],
    learningObjectives: [
      'Navigate the mission dashboard',
      'Understand agent outputs',
      'Review and interpret findings',
    ],
    customizableFields: [],
    fieldGroups: [],
    missionYaml: btoa(`
name: Hello Zero Day AI
description: Learn the basics of Zero Day AI
agent: debug-agent
target:
  type: demo
  url: https://demo.gibson.example
config:
  depth: light
  timeout: 60
    `.trim()),
    hasPlaceholders: false,
    requiresConfirmation: false,
    sandboxMode: true,
    iconName: 'Rocket',
    featured: true,
    recommendedForOnboarding: true,
  },
  {
    id: 'subdomain-discovery',
    name: 'Subdomain Discovery',
    description: 'Discover subdomains for a target domain',
    longDescription: `
# Subdomain Discovery

Enumerate all subdomains for a given domain using:
- DNS zone transfers
- Certificate transparency logs
- Common subdomain wordlists
- Reverse DNS lookups
    `.trim(),
    version: '1.0.0',
    category: 'reconnaissance',
    difficulty: 'beginner',
    tags: ['recon', 'dns', 'subdomain', 'enumeration'],
    author: 'Zero Day AI Team',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    prerequisites: [
      {
        id: 'llm-provider',
        type: 'llm_provider',
        name: 'LLM Provider',
        description: 'An LLM provider must be configured',
        requirement: 'any',
        required: true,
      },
      {
        id: 'recon-agent',
        type: 'agent',
        name: 'Recon Agent',
        description: 'The reconnaissance agent is required',
        requirement: 'recon-agent',
        required: true,
      },
    ],
    estimatedRuntime: '5-10 minutes',
    expectedOutcomes: [
      'List of discovered subdomains',
      'DNS record details',
      'Potential attack surface analysis',
    ],
    learningObjectives: [
      'Understand subdomain enumeration techniques',
      'Analyze DNS configurations',
      'Identify potential entry points',
    ],
    customizableFields: [
      {
        key: 'target.domain',
        label: 'Target Domain',
        type: 'url',
        description: 'The domain to scan for subdomains',
        required: true,
        placeholder: 'example.com',
        validation: 'matches(value, "^[a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,}$")',
        validationMessage: 'Please enter a valid domain name',
      },
      {
        key: 'config.depth',
        label: 'Scan Depth',
        type: 'select',
        description: 'How thorough should the scan be',
        required: true,
        default: 'medium',
        options: [
          { value: 'light', label: 'Light', description: 'Quick scan, common subdomains only' },
          { value: 'medium', label: 'Medium', description: 'Balanced scan', recommended: true },
          { value: 'deep', label: 'Deep', description: 'Comprehensive enumeration' },
        ],
      },
    ],
    missionYaml: btoa(`
name: Subdomain Discovery
description: Enumerate subdomains for \${target.domain}
agent: recon-agent
target:
  type: domain
  domain: \${target.domain}
config:
  depth: \${config.depth}
  timeout: 600
tools:
  - dns-resolver
  - certificate-transparency
  - subdomain-brute
    `.trim()),
    hasPlaceholders: true,
    requiresConfirmation: false,
    sandboxMode: false,
    iconName: 'Search',
    recommendedForOnboarding: true,
  },
  {
    id: 'web-security-scan',
    name: 'Web Security Scan',
    description: 'Scan a web application for common vulnerabilities',
    version: '1.0.0',
    category: 'web-security',
    difficulty: 'intermediate',
    tags: ['web', 'owasp', 'security', 'vulnerabilities'],
    author: 'Zero Day AI Team',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    prerequisites: [
      {
        id: 'llm-provider',
        type: 'llm_provider',
        name: 'LLM Provider',
        description: 'An LLM provider must be configured',
        requirement: 'any',
        required: true,
      },
      {
        id: 'web-security-agent',
        type: 'agent',
        name: 'Web Security Agent',
        description: 'The web security agent is required',
        requirement: 'web-security-agent',
        required: true,
      },
    ],
    estimatedRuntime: '10-20 minutes',
    expectedOutcomes: [
      'OWASP Top 10 vulnerability assessment',
      'Security header analysis',
      'Input validation testing results',
    ],
    learningObjectives: [
      'Understand common web vulnerabilities',
      'Learn security header best practices',
      'Identify input validation issues',
    ],
    customizableFields: [
      {
        key: 'target.url',
        label: 'Target URL',
        type: 'url',
        description: 'The web application URL to scan',
        required: true,
        placeholder: 'https://example.com',
        validation: 'matches(value, "^https?://")',
        validationMessage: 'Please enter a valid URL starting with http:// or https://',
      },
      {
        key: 'config.authenticated',
        label: 'Authenticated Scan',
        type: 'boolean',
        description: 'Whether to perform authenticated testing',
        required: false,
        default: false,
      },
    ],
    missionYaml: btoa(`
name: Web Security Scan
description: Scan \${target.url} for vulnerabilities
agent: web-security-agent
target:
  type: web
  url: \${target.url}
config:
  authenticated: \${config.authenticated}
  depth: medium
  timeout: 1200
tools:
  - http-client
  - spider
  - header-analyzer
  - parameter-fuzzer
    `.trim()),
    hasPlaceholders: true,
    requiresConfirmation: true,
    sandboxMode: false,
    warningMessage: 'This scan may send test requests to the target. Ensure you have authorization.',
    iconName: 'Shield',
    recommendedForOnboarding: true,
  },
  {
    id: 'ssl-tls-audit',
    name: 'SSL/TLS Audit',
    description: 'Analyze SSL/TLS configuration and certificates',
    version: '1.0.0',
    category: 'compliance',
    difficulty: 'beginner',
    tags: ['ssl', 'tls', 'certificate', 'compliance'],
    author: 'Zero Day AI Team',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    prerequisites: [
      {
        id: 'llm-provider',
        type: 'llm_provider',
        name: 'LLM Provider',
        description: 'An LLM provider must be configured',
        requirement: 'any',
        required: true,
      },
    ],
    estimatedRuntime: '2-5 minutes',
    expectedOutcomes: [
      'Certificate validity and chain analysis',
      'TLS version and cipher suite assessment',
      'Security recommendations',
    ],
    learningObjectives: [
      'Understand SSL/TLS best practices',
      'Identify certificate issues',
      'Learn about cipher suite security',
    ],
    customizableFields: [
      {
        key: 'target.hostname',
        label: 'Hostname',
        type: 'string',
        description: 'The hostname to analyze',
        required: true,
        placeholder: 'example.com',
      },
      {
        key: 'target.port',
        label: 'Port',
        type: 'port',
        description: 'The port number (default: 443)',
        required: false,
        default: 443,
        min: 1,
        max: 65535,
      },
    ],
    missionYaml: btoa(`
name: SSL/TLS Audit
description: Analyze SSL/TLS for \${target.hostname}
agent: debug-agent
target:
  type: ssl
  hostname: \${target.hostname}
  port: \${target.port}
config:
  depth: medium
  timeout: 300
tools:
  - ssl-checker
    `.trim()),
    hasPlaceholders: true,
    requiresConfirmation: false,
    sandboxMode: false,
    iconName: 'Lock',
    recommendedForOnboarding: true,
  },
  {
    id: 'port-scan',
    name: 'Port Scan',
    description: 'Discover open ports and services on a target',
    version: '1.0.0',
    category: 'network-security',
    difficulty: 'intermediate',
    tags: ['network', 'ports', 'services', 'enumeration'],
    author: 'Zero Day AI Team',
    license: 'MIT',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    prerequisites: [
      {
        id: 'llm-provider',
        type: 'llm_provider',
        name: 'LLM Provider',
        description: 'An LLM provider must be configured',
        requirement: 'any',
        required: true,
      },
      {
        id: 'network-agent',
        type: 'agent',
        name: 'Network Agent',
        description: 'A network-capable agent is required',
        requirement: 'network-agent',
        required: false,
        alternatives: ['recon-agent'],
      },
    ],
    estimatedRuntime: '5-15 minutes',
    expectedOutcomes: [
      'List of open ports',
      'Service identification',
      'Version detection where possible',
    ],
    learningObjectives: [
      'Understand port scanning techniques',
      'Identify running services',
      'Assess network exposure',
    ],
    customizableFields: [
      {
        key: 'target.host',
        label: 'Target Host',
        type: 'string',
        description: 'IP address or hostname to scan',
        required: true,
        placeholder: '192.168.1.1 or example.com',
      },
      {
        key: 'config.portRange',
        label: 'Port Range',
        type: 'port-range',
        description: 'Range of ports to scan',
        required: false,
        default: '1-1024',
        placeholder: '1-1024',
      },
    ],
    missionYaml: btoa(`
name: Port Scan
description: Scan ports on \${target.host}
agent: recon-agent
target:
  type: network
  host: \${target.host}
config:
  portRange: \${config.portRange}
  timeout: 900
tools:
  - port-scanner
  - service-detector
    `.trim()),
    hasPlaceholders: true,
    requiresConfirmation: true,
    sandboxMode: false,
    warningMessage: 'Port scanning may be detected by security systems. Ensure you have authorization.',
    iconName: 'Network',
    recommendedForOnboarding: false,
  },
];

// ============================================================================
// Template Loading
// ============================================================================

/**
 * Get all available templates (built-in + custom)
 */
export function getAllTemplates(): MissionTemplate[] {
  // In a full implementation, this would also load custom templates from an API
  return [...BUILTIN_TEMPLATES];
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): MissionTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

/**
 * Get templates for list view
 */
export function getTemplateListItems(): MissionTemplateListItem[] {
  return getAllTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    difficulty: t.difficulty,
    estimatedRuntime: t.estimatedRuntime,
    iconName: t.iconName,
    featured: t.featured,
    recommendedForOnboarding: t.recommendedForOnboarding,
    usageCount: t.usageCount,
    rating: t.rating,
  }));
}

/**
 * Get onboarding-recommended templates
 */
export function getOnboardingTemplates(): MissionTemplateListItem[] {
  return getTemplateListItems().filter((t) => t.recommendedForOnboarding);
}

/**
 * Get featured templates
 */
export function getFeaturedTemplates(): MissionTemplateListItem[] {
  return getTemplateListItems().filter((t) => t.featured);
}

// ============================================================================
// Template Filtering & Sorting
// ============================================================================

/**
 * Filter templates based on criteria
 */
export function filterTemplates(
  templates: MissionTemplateListItem[],
  filters: TemplateFilters
): MissionTemplateListItem[] {
  return templates.filter((t) => {
    // Category filter
    if (filters.categories?.length && !filters.categories.includes(t.category)) {
      return false;
    }

    // Difficulty filter
    if (filters.difficulties?.length && !filters.difficulties.includes(t.difficulty)) {
      return false;
    }

    // Featured filter
    if (filters.featured && !t.featured) {
      return false;
    }

    // Onboarding filter
    if (filters.onboardingOnly && !t.recommendedForOnboarding) {
      return false;
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matches =
        t.name.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower);
      if (!matches) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort templates
 */
export function sortTemplates(
  templates: MissionTemplateListItem[],
  sort: TemplateSort
): MissionTemplateListItem[] {
  const sorted = [...templates];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sort.field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'usageCount':
        comparison = (a.usageCount || 0) - (b.usageCount || 0);
        break;
      case 'rating':
        comparison = (a.rating || 0) - (b.rating || 0);
        break;
      case 'difficulty':
        const difficultyOrder: Record<TemplateDifficulty, number> = {
          beginner: 1,
          intermediate: 2,
          advanced: 3,
        };
        comparison = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
        break;
    }

    return sort.direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Substitute variables in template YAML
 * Supports ${variable} syntax
 */
export function substituteVariables(
  yamlBase64: string,
  values: TemplateCustomValues
): string {
  let yaml = atob(yamlBase64);

  // Replace ${key} patterns with values
  yaml = yaml.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const value = getNestedValue(values, key);
    if (value === undefined) {
      return match; // Keep original if no value provided
    }
    return String(value);
  });

  return yaml;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj as unknown);
}

// ============================================================================
// Template Rendering
// ============================================================================

/**
 * Validate custom field values
 */
export function validateCustomValues(
  fields: CustomizableField[],
  values: TemplateCustomValues
): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  for (const field of fields) {
    const value = values[field.key];

    // Required check
    if (field.required && (value === undefined || value === '' || value === null)) {
      errors.push({
        field: field.key,
        message: `${field.label} is required`,
        code: 'REQUIRED',
      });
      continue;
    }

    // Skip further validation if no value and not required
    if (value === undefined || value === '') {
      continue;
    }

    // Type-specific validation
    switch (field.type) {
      case 'url':
        if (typeof value === 'string' && !isValidUrl(value)) {
          errors.push({
            field: field.key,
            message: field.validationMessage || 'Please enter a valid URL',
            code: 'INVALID_URL',
          });
        }
        break;

      case 'number':
      case 'port':
        const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
        if (typeof numValue !== 'number' || isNaN(numValue)) {
          errors.push({
            field: field.key,
            message: 'Please enter a valid number',
            code: 'INVALID_NUMBER',
          });
        } else {
          if (field.min !== undefined && numValue < field.min) {
            errors.push({
              field: field.key,
              message: `Value must be at least ${field.min}`,
              code: 'MIN_VALUE',
            });
          }
          if (field.max !== undefined && numValue > field.max) {
            errors.push({
              field: field.key,
              message: `Value must be at most ${field.max}`,
              code: 'MAX_VALUE',
            });
          }
        }
        break;

      case 'ip':
        if (typeof value === 'string' && !isValidIp(value)) {
          errors.push({
            field: field.key,
            message: 'Please enter a valid IP address',
            code: 'INVALID_IP',
          });
        }
        break;

      case 'cidr':
        if (typeof value === 'string' && !isValidCidr(value)) {
          errors.push({
            field: field.key,
            message: 'Please enter a valid CIDR range',
            code: 'INVALID_CIDR',
          });
        }
        break;

      case 'port-range':
        if (typeof value === 'string' && !isValidPortRange(value)) {
          errors.push({
            field: field.key,
            message: 'Please enter a valid port range (e.g., 1-1024)',
            code: 'INVALID_PORT_RANGE',
          });
        }
        break;
    }

    // Pattern validation
    if (field.pattern && typeof value === 'string') {
      const regex = new RegExp(field.pattern);
      if (!regex.test(value)) {
        errors.push({
          field: field.key,
          message: field.validationMessage || 'Invalid format',
          code: 'PATTERN_MISMATCH',
        });
      }
    }
  }

  return errors;
}

/**
 * Render a template with custom values
 */
export function renderTemplate(
  template: MissionTemplate,
  values: TemplateCustomValues
): TemplateRenderResult {
  // Validate values
  const errors = validateCustomValues(template.customizableFields, values);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Build complete values with defaults
  const completeValues: TemplateCustomValues = {};
  for (const field of template.customizableFields) {
    const providedValue = values[field.key];
    if (providedValue !== undefined) {
      completeValues[field.key] = providedValue;
    } else if (field.default !== undefined) {
      completeValues[field.key] = field.default;
    }
  }

  // Substitute variables
  const yaml = substituteVariables(template.missionYaml, completeValues);

  return { success: true, yaml };
}


// ============================================================================
// Validation Helpers
// ============================================================================

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isValidIp(value: string): boolean {
  // IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(value)) {
    const parts = value.split('.').map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  // IPv6 simplified check
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(value);
}

function isValidCidr(value: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(value)) return false;

  const [ip, prefix] = value.split('/');
  const prefixNum = parseInt(prefix, 10);
  return isValidIp(ip) && prefixNum >= 0 && prefixNum <= 32;
}

function isValidPortRange(value: string): boolean {
  const rangeRegex = /^(\d+)(-(\d+))?$/;
  const match = value.match(rangeRegex);
  if (!match) return false;

  const start = parseInt(match[1], 10);
  const end = match[3] ? parseInt(match[3], 10) : start;

  return (
    start >= 1 &&
    start <= 65535 &&
    end >= 1 &&
    end <= 65535 &&
    start <= end
  );
}

export default {
  getAllTemplates,
  getTemplateById,
  getTemplateListItems,
  getOnboardingTemplates,
  getFeaturedTemplates,
  filterTemplates,
  sortTemplates,
  substituteVariables,
  validateCustomValues,
  renderTemplate,
};
