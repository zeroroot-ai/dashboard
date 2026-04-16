/**
 * useMissionTemplates Hook
 *
 * Data fetching hook for mission templates using TanStack Query.
 * Features:
 * - Template listing with filtering
 * - Individual template fetching
 * - Caching for performance
 * - Variable substitution support
 */

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  substituteVariables,
  validateVariableValues,
  type TemplateSubstitutionResult,
} from '@/src/lib/mission/templates';
import type {
  MissionTemplate,
  TemplateCategory,
  TemplateVariable,
} from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface UseTemplatesOptions {
  /** Filter by category */
  category?: TemplateCategory;
  /** Search query */
  query?: string;
  /** Filter by tags */
  tags?: string[];
  /** Enable auto-refetch */
  enabled?: boolean;
}

export interface UseTemplatesReturn {
  /** List of templates */
  templates: MissionTemplate[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch templates */
  refetch: () => void;
}

export interface UseTemplateReturn {
  /** Template data */
  template: MissionTemplate | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch template */
  refetch: () => void;
}

// ============================================================================
// Query Keys
// ============================================================================

export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (filters: UseTemplatesOptions) => [...templateKeys.lists(), filters] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchTemplates(options: UseTemplatesOptions): Promise<MissionTemplate[]> {
  const params = new URLSearchParams();

  if (options.category) {
    params.set('category', options.category);
  }
  if (options.query) {
    params.set('query', options.query);
  }
  if (options.tags && options.tags.length > 0) {
    params.set('tags', options.tags.join(','));
  }

  const url = `/api/missions/templates${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch templates');
  }

  return response.json();
}

async function fetchTemplate(id: string): Promise<MissionTemplate> {
  const response = await fetch(`/api/missions/templates/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Template not found');
    }
    throw new Error('Failed to fetch template');
  }

  return response.json();
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch list of templates with filtering
 */
export function useMissionTemplates(
  options: UseTemplatesOptions = {}
): UseTemplatesReturn {
  const { enabled = true, ...filters } = options;

  const query = useQuery({
    queryKey: templateKeys.list(filters),
    queryFn: () => fetchTemplates(filters),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
  });

  return {
    templates: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch a single template by ID
 */
export function useMissionTemplate(
  templateId: string | null | undefined
): UseTemplateReturn {
  const query = useQuery({
    queryKey: templateKeys.detail(templateId || ''),
    queryFn: () => fetchTemplate(templateId!),
    enabled: !!templateId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
  });

  return {
    template: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to prefetch a template (for hover/focus states)
 */
export function usePrefetchTemplate() {
  const queryClient = useQueryClient();

  return React.useCallback(
    (templateId: string) => {
      queryClient.prefetchQuery({
        queryKey: templateKeys.detail(templateId),
        queryFn: () => fetchTemplate(templateId),
        staleTime: 10 * 60 * 1000,
      });
    },
    [queryClient]
  );
}

/**
 * Hook for template variable management
 */
export function useTemplateVariables(template: MissionTemplate | null) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});

  // Initialize with default values when template changes
  React.useEffect(() => {
    if (!template?.variables) {
      setValues({});
      return;
    }

    const defaults: Record<string, unknown> = {};
    for (const variable of template.variables) {
      if (variable.defaultValue !== undefined) {
        defaults[variable.name] = variable.defaultValue;
      }
    }
    setValues(defaults);
  }, [template?.id]);

  // Set a single variable value
  const setValue = React.useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // Set multiple variable values
  const setMultipleValues = React.useCallback(
    (newValues: Record<string, unknown>) => {
      setValues((prev) => ({ ...prev, ...newValues }));
    },
    []
  );

  // Clear all values
  const clearValues = React.useCallback(() => {
    setValues({});
  }, []);

  // Validate current values
  const validation = React.useMemo(() => {
    if (!template?.variables) {
      return { valid: true, missing: [] };
    }
    return validateVariableValues(template.variables, values);
  }, [template?.variables, values]);

  // Substitute variables and get result
  const substitutionResult = React.useMemo((): TemplateSubstitutionResult | null => {
    if (!template?.yamlContent) return null;
    return substituteVariables(template.yamlContent, values);
  }, [template?.yamlContent, values]);

  return {
    values,
    setValue,
    setMultipleValues,
    clearValues,
    validation,
    substitutionResult,
    variables: template?.variables ?? [],
  };
}

/**
 * Hook for template categories with counts
 */
export function useTemplateCategories() {
  const { templates, isLoading } = useMissionTemplates();

  const categories = React.useMemo(() => {
    const counts: Record<TemplateCategory, number> = {
      'web-security': 0,
      web: 0,
      'api-testing': 0,
      api: 0,
      network: 0,
      cloud: 0,
      repository: 0,
      compliance: 0,
      custom: 0,
      recon: 0,
      osint: 0,
      exploitation: 0,
    };

    for (const template of templates) {
      counts[template.category]++;
    }

    return Object.entries(counts).map(([category, count]) => ({
      category: category as TemplateCategory,
      count,
    }));
  }, [templates]);

  return {
    categories,
    isLoading,
    totalCount: templates.length,
  };
}

/**
 * Hook for template search with debouncing
 */
export function useTemplateSearch(debounceMs: number = 300) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Debounce the search query
  React.useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, debounceMs]);

  const { templates, isLoading, error } = useMissionTemplates({
    query: debouncedQuery || undefined,
  });

  return {
    searchQuery,
    setSearchQuery,
    templates,
    isLoading,
    error,
    isSearching: searchQuery !== debouncedQuery,
  };
}

// ============================================================================
// Export
// ============================================================================

export default useMissionTemplates;
