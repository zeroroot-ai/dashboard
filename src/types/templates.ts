/**
 * Mission Template Type Definitions
 * Type definitions for mission templates used in onboarding and quick-start flows
 */

// ============================================================================
// Template Category Types
// ============================================================================

/**
 * Category classification for mission templates.
 */
export type TemplateCategory =
  | 'reconnaissance'
  | 'vulnerability-scan'
  | 'compliance'
  | 'web-security'
  | 'network-security'
  | 'cloud-security'
  | 'custom';

/**
 * Difficulty level for mission templates.
 */
export type TemplateDifficulty = 'beginner' | 'intermediate' | 'advanced';

/**
 * Template category display configuration.
 */
export const TEMPLATE_CATEGORY_CONFIG: Record<TemplateCategory, {
  label: string;
  description: string;
  icon: string;
  color: string;
}> = {
  reconnaissance: {
    label: 'Reconnaissance',
    description: 'Discover and enumerate targets',
    icon: 'Search',
    color: '#6366F1',
  },
  'vulnerability-scan': {
    label: 'Vulnerability Scanning',
    description: 'Identify security weaknesses',
    icon: 'ShieldAlert',
    color: '#EF4444',
  },
  compliance: {
    label: 'Compliance',
    description: 'Check against security standards',
    icon: 'ClipboardCheck',
    color: '#10B981',
  },
  'web-security': {
    label: 'Web Security',
    description: 'Test web applications',
    icon: 'Globe',
    color: '#3B82F6',
  },
  'network-security': {
    label: 'Network Security',
    description: 'Analyze network infrastructure',
    icon: 'Network',
    color: '#8B5CF6',
  },
  'cloud-security': {
    label: 'Cloud Security',
    description: 'Assess cloud configurations',
    icon: 'Cloud',
    color: '#F59E0B',
  },
  custom: {
    label: 'Custom',
    description: 'User-created templates',
    icon: 'Wrench',
    color: '#6B7280',
  },
};

/**
 * Template difficulty display configuration.
 */
export const TEMPLATE_DIFFICULTY_CONFIG: Record<TemplateDifficulty, {
  label: string;
  description: string;
  color: string;
  badgeVariant: 'success' | 'warning' | 'error';
}> = {
  beginner: {
    label: 'Beginner',
    description: 'Simple configuration, minimal prerequisites',
    color: '#10B981',
    badgeVariant: 'success',
  },
  intermediate: {
    label: 'Intermediate',
    description: 'Moderate complexity, some experience recommended',
    color: '#F59E0B',
    badgeVariant: 'warning',
  },
  advanced: {
    label: 'Advanced',
    description: 'Complex configuration, requires expertise',
    color: '#EF4444',
    badgeVariant: 'error',
  },
};

// ============================================================================
// Prerequisite Types
// ============================================================================

/**
 * Type of prerequisite requirement.
 */
export type PrerequisiteType =
  | 'llm_provider'
  | 'agent'
  | 'tool'
  | 'plugin'
  | 'configuration';

/**
 * Status of a template prerequisite.
 */
export interface PrerequisiteStatus {
  /** Whether all prerequisites are met */
  met: boolean;
  /** List of missing prerequisite identifiers */
  missing: string[];
  /** Detailed status per prerequisite */
  details: PrerequisiteCheckResult[];
}

/**
 * Result of checking a single prerequisite.
 */
export interface PrerequisiteCheckResult {
  /** Prerequisite ID */
  id: string;
  /** Whether this prerequisite is met */
  met: boolean;
  /** Error message if not met */
  error?: string;
  /** URL to resolve the missing prerequisite */
  actionUrl?: string;
  /** Action label for resolving */
  actionLabel?: string;
}

/**
 * A single prerequisite requirement for a template.
 */
export interface TemplatePrerequisite {
  /** Unique prerequisite identifier */
  id: string;
  /** Prerequisite type */
  type: PrerequisiteType;
  /** Human-readable name */
  name: string;
  /** Description of why this is required */
  description: string;
  /** Specific requirement value (e.g., agent name, tool name) */
  requirement: string;
  /** Whether this is a strict requirement or optional */
  required: boolean;
  /** Alternative requirements that can satisfy this (OR logic) */
  alternatives?: string[];
  /** URL to help fulfill this prerequisite */
  helpUrl?: string;
}

// ============================================================================
// Customizable Field Types
// ============================================================================

/**
 * Type of customizable field value.
 */
export type CustomizableFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'url'
  | 'ip'
  | 'cidr'
  | 'port'
  | 'port-range'
  | 'file'
  | 'secret';

/**
 * A customizable field in a mission template.
 */
export interface CustomizableField {
  /** YAML path key (e.g., "spec.target.url") */
  key: string;
  /** Human-readable label */
  label: string;
  /** Field input type */
  type: CustomizableFieldType;
  /** Help text description */
  description: string;
  /** Whether this field is required */
  required: boolean;
  /** Default value */
  default?: string | number | boolean | string[];
  /** Placeholder text */
  placeholder?: string;
  /** Available options for select/multiselect types */
  options?: CustomizableFieldOption[];
  /** CEL validation expression */
  validation?: string;
  /** Custom validation error message */
  validationMessage?: string;
  /** Minimum value for number types */
  min?: number;
  /** Maximum value for number types */
  max?: number;
  /** Regex pattern for string validation */
  pattern?: string;
  /** Group this field belongs to for UI organization */
  group?: string;
  /** Order within the group */
  order?: number;
  /** Whether this field should be hidden (advanced) */
  advanced?: boolean;
  /** Conditional display (CEL expression) */
  condition?: string;
}

/**
 * Option for select/multiselect customizable fields.
 */
export interface CustomizableFieldOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Description for tooltip */
  description?: string;
  /** Whether this is the recommended option */
  recommended?: boolean;
}

/**
 * Group of related customizable fields.
 */
export interface CustomizableFieldGroup {
  /** Group identifier */
  id: string;
  /** Group display name */
  label: string;
  /** Group description */
  description?: string;
  /** Display order */
  order: number;
  /** Whether this group is collapsed by default */
  collapsed?: boolean;
}

// ============================================================================
// Mission Template Types
// ============================================================================

/**
 * Complete mission template definition.
 */
export interface MissionTemplate {
  /** Unique template identifier */
  id: string;
  /** Template display name */
  name: string;
  /** Brief description */
  description: string;
  /** Detailed long description (markdown supported) */
  longDescription?: string;
  /** Semantic version */
  version: string;

  // Classification
  /** Template category */
  category: TemplateCategory;
  /** Difficulty level */
  difficulty: TemplateDifficulty;
  /** Searchable tags */
  tags: string[];

  // Metadata
  /** Template author */
  author: string;
  /** Author URL or profile */
  authorUrl?: string;
  /** License identifier */
  license: string;
  /** Creation date (ISO 8601) */
  createdAt: string;
  /** Last update date (ISO 8601) */
  updatedAt: string;

  // Requirements
  /** Prerequisites for using this template */
  prerequisites: TemplatePrerequisite[];

  // Execution info
  /** Estimated runtime (e.g., "5-10 minutes") */
  estimatedRuntime: string;
  /** Expected outcomes/results descriptions */
  expectedOutcomes: string[];
  /** Educational learning objectives */
  learningObjectives: string[];

  // Customization
  /** Customizable fields with placeholders */
  customizableFields: CustomizableField[];
  /** Field groups for UI organization */
  fieldGroups?: CustomizableFieldGroup[];

  // Mission definition
  /** Base64 encoded mission YAML with placeholders */
  missionYaml: string;
  /** Whether YAML contains placeholders requiring substitution */
  hasPlaceholders: boolean;

  // Safety
  /** Whether user must confirm before running */
  requiresConfirmation: boolean;
  /** Enable sandbox mode with limited capabilities */
  sandboxMode: boolean;
  /** Warning message to display before execution */
  warningMessage?: string;

  // Display
  /** Lucide icon name */
  iconName: string;
  /** Cover/preview image URL */
  coverImage?: string;
  /** Whether this is featured/highlighted */
  featured?: boolean;
  /** Whether this is recommended for new users */
  recommendedForOnboarding?: boolean;

  // Usage stats (populated at runtime)
  /** Number of times used */
  usageCount?: number;
  /** Average success rate (0-100) */
  successRate?: number;
  /** Average rating (1-5) */
  rating?: number;
  /** Number of ratings */
  ratingCount?: number;
}

/**
 * Minimal template info for list views.
 */
export interface MissionTemplateListItem {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  difficulty: TemplateDifficulty;
  estimatedRuntime: string;
  iconName: string;
  featured?: boolean;
  recommendedForOnboarding?: boolean;
  usageCount?: number;
  rating?: number;
}

// ============================================================================
// Template Rendering Types
// ============================================================================

/**
 * Result of rendering a template with custom values.
 */
export interface TemplateRenderResult {
  /** Whether rendering succeeded */
  success: boolean;
  /** Rendered mission YAML (if success) */
  yaml?: string;
  /** Validation errors (if failed) */
  errors?: TemplateValidationError[];
}

/**
 * Validation error for template rendering.
 */
export interface TemplateValidationError {
  /** Field key that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
}

/**
 * Values provided for template customization.
 */
export type TemplateCustomValues = Record<string, string | number | boolean | string[]>;

// ============================================================================
// Template API Types
// ============================================================================

/**
 * Request to list available templates.
 */
export interface ListTemplatesRequest {
  /** Filter by category */
  category?: TemplateCategory;
  /** Filter by difficulty */
  difficulty?: TemplateDifficulty;
  /** Filter by tags */
  tags?: string[];
  /** Search query */
  search?: string;
  /** Only show featured templates */
  featured?: boolean;
  /** Only show onboarding-recommended templates */
  onboardingOnly?: boolean;
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
  /** Sort field */
  sortBy?: 'name' | 'usageCount' | 'rating' | 'updatedAt';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Response from listing templates.
 */
export interface ListTemplatesResponse {
  /** Templates matching the query */
  templates: MissionTemplateListItem[];
  /** Total count (for pagination) */
  total: number;
  /** Whether more results exist */
  hasMore: boolean;
}

/**
 * Request to get a single template by ID.
 */
export interface GetTemplateRequest {
  /** Template ID */
  id: string;
  /** Whether to check prerequisites */
  checkPrerequisites?: boolean;
}

/**
 * Response from getting a template.
 */
export interface GetTemplateResponse {
  /** Full template details */
  template: MissionTemplate;
  /** Prerequisite status (if requested) */
  prerequisiteStatus?: PrerequisiteStatus;
}

/**
 * Request to render a template with custom values.
 */
export interface RenderTemplateRequest {
  /** Template ID */
  templateId: string;
  /** Custom field values */
  values: TemplateCustomValues;
  /** Whether to validate only (don't create mission) */
  validateOnly?: boolean;
}

/**
 * Response from rendering a template.
 */
export interface RenderTemplateResponse {
  /** Render result */
  result: TemplateRenderResult;
  /** Created mission ID (if not validateOnly) */
  missionId?: string;
}

/**
 * Request to check template prerequisites.
 */
export interface CheckPrerequisitesRequest {
  /** Template ID */
  templateId: string;
}

/**
 * Response from prerequisite check.
 */
export interface CheckPrerequisitesResponse {
  /** Prerequisite status */
  status: PrerequisiteStatus;
}

// ============================================================================
// Template Filters and Sorting
// ============================================================================

/**
 * Filter options for template browsing.
 */
export interface TemplateFilters {
  /** Selected categories */
  categories?: TemplateCategory[];
  /** Selected difficulties */
  difficulties?: TemplateDifficulty[];
  /** Selected tags */
  tags?: string[];
  /** Search query */
  search?: string;
  /** Only featured */
  featured?: boolean;
  /** Only onboarding recommended */
  onboardingOnly?: boolean;
}

/**
 * Sort options for templates.
 */
export interface TemplateSort {
  /** Sort field */
  field: 'name' | 'usageCount' | 'rating' | 'updatedAt' | 'difficulty';
  /** Sort direction */
  direction: 'asc' | 'desc';
}

// ============================================================================
// Starter Templates
// ============================================================================

/**
 * IDs of recommended starter templates for onboarding.
 */
export const ONBOARDING_TEMPLATE_IDS = [
  'getting-started',
  'web-scan-basic',
  'network-discovery',
  'api-security-check',
  'compliance-quick-check',
] as const;

/**
 * All template categories as array.
 */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'reconnaissance',
  'vulnerability-scan',
  'compliance',
  'web-security',
  'network-security',
  'cloud-security',
  'custom',
];

/**
 * All template difficulties as array.
 */
export const TEMPLATE_DIFFICULTIES: TemplateDifficulty[] = [
  'beginner',
  'intermediate',
  'advanced',
];
