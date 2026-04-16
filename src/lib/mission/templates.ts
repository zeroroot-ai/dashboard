/**
 * Mission Templates Utilities
 *
 * Template loading, parsing, and variable substitution for mission creation.
 * Features:
 * - Template loading and parsing
 * - Variable substitution (${VARIABLE} syntax)
 * - Template search and filtering
 * - Template metadata extraction
 */

import type { MissionTemplate, TemplateVariable, TemplateCategory } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface TemplateSearchOptions {
  /** Filter by category */
  category?: TemplateCategory;
  /** Search query (matches name, description, tags) */
  query?: string;
  /** Filter by tags */
  tags?: string[];
  /** Sort field */
  sortBy?: 'name' | 'category' | 'createdAt' | 'usageCount';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

export interface TemplateSubstitutionResult {
  /** Substituted YAML content */
  content: string;
  /** Variables that were substituted */
  substituted: string[];
  /** Variables that were not found in the template */
  unused: string[];
  /** Variables that are still unsubstituted (no value provided) */
  remaining: string[];
}

// ============================================================================
// Variable Extraction
// ============================================================================

/** Regex for variable placeholders: ${VARIABLE_NAME} */
const VARIABLE_REGEX = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Extract variable placeholders from YAML content
 */
export function extractVariables(yamlContent: string): string[] {
  const variables = new Set<string>();
  let match;

  while ((match = VARIABLE_REGEX.exec(yamlContent)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
}

/**
 * Extract variable definitions from template YAML
 * Variables are defined in a special `_variables` section
 */
export function parseTemplateVariables(
  yamlContent: string,
  variableDefinitions?: Record<string, Partial<TemplateVariable>>
): TemplateVariable[] {
  const variableNames = extractVariables(yamlContent);
  const definitions = variableDefinitions || {};

  return variableNames.map((name) => ({
    name,
    type: definitions[name]?.type || 'string',
    label: definitions[name]?.label || formatVariableName(name),
    description: definitions[name]?.description || '',
    required: definitions[name]?.required ?? true,
    defaultValue: definitions[name]?.defaultValue,
    placeholder: definitions[name]?.placeholder,
  }));
}

/**
 * Format variable name for display
 * e.g., TARGET_URL -> Target URL
 */
function formatVariableName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Substitute variables in template content
 */
export function substituteVariables(
  yamlContent: string,
  values: Record<string, unknown>
): TemplateSubstitutionResult {
  const allVariables = extractVariables(yamlContent);
  const substituted: string[] = [];
  const unused: string[] = [];
  const remaining: string[] = [];

  // Track which provided values were used
  const usedKeys = new Set<string>();

  // Substitute each variable
  let content = yamlContent;
  for (const varName of allVariables) {
    if (varName in values) {
      const value = String(values[varName]);
      const placeholder = new RegExp(`\\$\\{${varName}\\}`, 'g');
      content = content.replace(placeholder, value);
      substituted.push(varName);
      usedKeys.add(varName);
    } else {
      remaining.push(varName);
    }
  }

  // Find unused provided values
  for (const key of Object.keys(values)) {
    if (!usedKeys.has(key)) {
      unused.push(key);
    }
  }

  return {
    content,
    substituted,
    unused,
    remaining,
  };
}

/**
 * Check if all required variables have values
 */
export function validateVariableValues(
  variables: TemplateVariable[],
  values: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const variable of variables) {
    if (variable.required && !(variable.name in values)) {
      missing.push(variable.name);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

// ============================================================================
// Template Search & Filtering
// ============================================================================

/**
 * Search and filter templates
 */
export function searchTemplates(
  templates: MissionTemplate[],
  options: TemplateSearchOptions = {}
): MissionTemplate[] {
  let result = [...templates];

  // Filter by category
  if (options.category) {
    result = result.filter((t) => t.category === options.category);
  }

  // Filter by search query
  if (options.query) {
    const query = options.query.toLowerCase();
    result = result.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
    );
  }

  // Filter by tags
  if (options.tags && options.tags.length > 0) {
    const searchTags = options.tags.map((t) => t.toLowerCase());
    result = result.filter((t) =>
      searchTags.every((searchTag) =>
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(searchTag))
      )
    );
  }

  // Sort
  if (options.sortBy) {
    const direction = options.sortDirection === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      let comparison = 0;
      switch (options.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
          break;
        case 'usageCount':
          comparison = (a.usageCount || 0) - (b.usageCount || 0);
          break;
      }
      return comparison * direction;
    });
  }

  return result;
}

/**
 * Group templates by category
 */
export function groupTemplatesByCategory(
  templates: MissionTemplate[]
): Record<TemplateCategory, MissionTemplate[]> {
  const groups: Record<string, MissionTemplate[]> = {};

  for (const template of templates) {
    if (!groups[template.category]) {
      groups[template.category] = [];
    }
    groups[template.category].push(template);
  }

  return groups as Record<TemplateCategory, MissionTemplate[]>;
}

/**
 * Get unique tags from templates
 */
export function getUniqueTags(templates: MissionTemplate[]): string[] {
  const tags = new Set<string>();
  for (const template of templates) {
    for (const tag of template.tags ?? []) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort();
}

// ============================================================================
// Template Validation
// ============================================================================

/**
 * Validate template structure
 */
export function validateTemplate(
  template: Partial<MissionTemplate>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template.name || template.name.trim().length === 0) {
    errors.push('Template name is required');
  }

  if (!template.yamlContent || template.yamlContent.trim().length === 0) {
    errors.push('Template YAML content is required');
  }

  if (!template.category) {
    errors.push('Template category is required');
  }

  // Check for valid YAML structure
  if (template.yamlContent) {
    try {
      // Basic check - ensure it has a name field
      if (!template.yamlContent.includes('name:')) {
        errors.push('Template YAML must include a name field');
      }
    } catch (error) {
      errors.push('Template YAML is malformed');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Template Metadata
// ============================================================================

/**
 * Extract metadata from template YAML
 */
export function extractTemplateMetadata(
  yamlContent: string
): Partial<MissionTemplate> {
  const metadata: Partial<MissionTemplate> = {};

  // Extract name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    metadata.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  // Extract description
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  if (descMatch) {
    metadata.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  // Extract tags
  const tagsMatch = yamlContent.match(/^tags:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (tagsMatch) {
    metadata.tags = tagsMatch[1]
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }

  // Extract variables
  metadata.variables = parseTemplateVariables(yamlContent);

  return metadata;
}

// ============================================================================
// Template Loading
// ============================================================================

/**
 * Load template from API
 */
export async function loadTemplate(templateId: string): Promise<MissionTemplate | null> {
  try {
    const response = await fetch(`/api/missions/templates/${templateId}`);
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('[Templates] Failed to load template:', error);
    return null;
  }
}

/**
 * Load all templates
 */
export async function loadTemplates(
  options: TemplateSearchOptions = {}
): Promise<MissionTemplate[]> {
  try {
    const params = new URLSearchParams();
    if (options.category) params.set('category', options.category);
    if (options.query) params.set('query', options.query);
    if (options.tags) params.set('tags', options.tags.join(','));

    const response = await fetch(`/api/missions/templates?${params.toString()}`);
    if (!response.ok) {
      return [];
    }
    return response.json();
  } catch (error) {
    console.error('[Templates] Failed to load templates:', error);
    return [];
  }
}

// ============================================================================
// Template Categories
// ============================================================================

export const TEMPLATE_CATEGORIES: Array<{
  id: TemplateCategory;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'web',
    label: 'Web Application',
    description: 'Scan web applications for vulnerabilities',
    icon: 'Globe',
  },
  {
    id: 'api',
    label: 'API Testing',
    description: 'Test REST, GraphQL, and other API endpoints',
    icon: 'Plug',
  },
  {
    id: 'network',
    label: 'Network Discovery',
    description: 'Discover and map network infrastructure',
    icon: 'Network',
  },
  {
    id: 'cloud',
    label: 'Cloud Security',
    description: 'Assess cloud infrastructure security',
    icon: 'Cloud',
  },
  {
    id: 'repository',
    label: 'Code Repository',
    description: 'Scan code repositories for secrets and vulnerabilities',
    icon: 'GitBranch',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Custom mission configurations',
    icon: 'Settings',
  },
];

// ============================================================================
// Export
// ============================================================================

export default {
  extractVariables,
  parseTemplateVariables,
  substituteVariables,
  validateVariableValues,
  searchTemplates,
  groupTemplatesByCategory,
  getUniqueTags,
  validateTemplate,
  extractTemplateMetadata,
  loadTemplate,
  loadTemplates,
  TEMPLATE_CATEGORIES,
};
