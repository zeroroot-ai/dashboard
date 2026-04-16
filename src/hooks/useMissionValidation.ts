/**
 * useMissionValidation Hook
 *
 * Real-time validation hook for mission YAML content.
 * Features:
 * - Debounced client-side validation (300ms default)
 * - Optional server-side validation via API
 * - Integration with TanStack Query for caching
 * - Automatic validation state management
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  validateMissionYAML,
  addLineNumbers,
  type ValidationResult,
} from '@/src/lib/mission/validation';
import { useMissionCreationStore } from '@/src/stores/missionCreationStore';
import type { ValidationError, ValidationWarning } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface UseMissionValidationOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Whether to use server-side validation */
  useServerValidation?: boolean;
  /** Auto-validate on content change */
  autoValidate?: boolean;
  /** Callback when validation completes */
  onValidationComplete?: (result: ValidationResult) => void;
}

export interface UseMissionValidationReturn {
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Whether the content is valid */
  isValid: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings */
  warnings: ValidationWarning[];
  /** Last validation result */
  lastResult: ValidationResult | null;
  /** Trigger manual validation */
  validate: () => Promise<ValidationResult>;
  /** Clear validation state */
  clearValidation: () => void;
  /** Validate specific content (without updating store) */
  validateContent: (content: string) => Promise<ValidationResult>;
}

// ============================================================================
// Server Validation API
// ============================================================================

async function serverValidate(yamlContent: string): Promise<ValidationResult> {
  const response = await fetch('/api/missions/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ yaml: yamlContent }),
  });

  if (!response.ok) {
    throw new Error('Server validation failed');
  }

  return response.json();
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useMissionValidation(
  options: UseMissionValidationOptions = {}
): UseMissionValidationReturn {
  const {
    debounceMs = 300,
    useServerValidation = false,
    autoValidate = true,
    onValidationComplete,
  } = options;

  // Store state
  const yamlContent = useMissionCreationStore((state) => state.yamlContent);
  const setValidationErrors = useMissionCreationStore((state) => state.setValidationErrors);
  const setValidationWarnings = useMissionCreationStore((state) => state.setValidationWarnings);

  // Local state
  const [lastResult, setLastResult] = React.useState<ValidationResult | null>(null);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = React.useRef<string>('');
  const queryClient = useQueryClient();

  // Client-side validation function
  const validateClientSide = React.useCallback(
    (content: string): ValidationResult => {
      const result = validateMissionYAML(content);

      // Add line numbers to errors
      const errorsWithLines = addLineNumbers(content, result.errors);

      return {
        ...result,
        errors: errorsWithLines,
      };
    },
    []
  );

  // Server validation mutation
  const serverValidationMutation = useMutation({
    mutationFn: serverValidate,
    onSuccess: (result) => {
      setLastResult(result);
      setValidationErrors(result.errors);
      setValidationWarnings(result.warnings);
      onValidationComplete?.(result);
    },
  });

  // Main validation function
  const validateContent = React.useCallback(
    async (content: string): Promise<ValidationResult> => {
      // Always do client-side validation first
      const clientResult = validateClientSide(content);

      // If client-side fails or server validation not enabled, return client result
      if (!clientResult.isValid || !useServerValidation) {
        setLastResult(clientResult);
        setValidationErrors(clientResult.errors);
        setValidationWarnings(clientResult.warnings);
        onValidationComplete?.(clientResult);
        return clientResult;
      }

      // Do server-side validation
      try {
        const serverResult = await serverValidationMutation.mutateAsync(content);
        return serverResult;
      } catch (error) {
        // Fall back to client result on server error
        console.error('[Validation] Server validation failed, using client result:', error);
        return clientResult;
      }
    },
    [
      validateClientSide,
      useServerValidation,
      serverValidationMutation,
      setValidationErrors,
      setValidationWarnings,
      onValidationComplete,
    ]
  );

  // Validate current store content
  const validate = React.useCallback(async (): Promise<ValidationResult> => {
    return validateContent(yamlContent);
  }, [validateContent, yamlContent]);

  // Clear validation state
  const clearValidation = React.useCallback(() => {
    setLastResult(null);
    setValidationErrors([]);
    setValidationWarnings([]);
  }, [setValidationErrors, setValidationWarnings]);

  // Auto-validate on content change (debounced)
  React.useEffect(() => {
    if (!autoValidate) return;

    // Skip if content hasn't changed
    if (yamlContent === lastContentRef.current) return;
    lastContentRef.current = yamlContent;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce validation
    debounceTimerRef.current = setTimeout(() => {
      validateContent(yamlContent);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [yamlContent, autoValidate, debounceMs, validateContent]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    isValidating: serverValidationMutation.isPending,
    isValid: lastResult?.isValid ?? false,
    errors: lastResult?.errors ?? [],
    warnings: lastResult?.warnings ?? [],
    lastResult,
    validate,
    clearValidation,
    validateContent,
  };
}

// ============================================================================
// Additional Hooks
// ============================================================================

/**
 * Hook for fetching validation status from server
 * Useful for checking if a mission can be submitted
 */
export function useValidationStatus(missionId?: string) {
  return useQuery({
    queryKey: ['mission-validation', missionId],
    queryFn: async () => {
      if (!missionId) return null;

      const response = await fetch(`/api/missions/${missionId}/validation`);
      if (!response.ok) {
        throw new Error('Failed to fetch validation status');
      }
      return response.json();
    },
    enabled: !!missionId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook for validation with immediate feedback
 * No debouncing - validates immediately on change
 */
export function useImmediateValidation() {
  const yamlContent = useMissionCreationStore((state) => state.yamlContent);
  const [result, setResult] = React.useState<ValidationResult | null>(null);

  React.useEffect(() => {
    if (!yamlContent.trim()) {
      setResult(null);
      return;
    }

    const validationResult = validateMissionYAML(yamlContent);
    const errorsWithLines = addLineNumbers(yamlContent, validationResult.errors);

    setResult({
      ...validationResult,
      errors: errorsWithLines,
    });
  }, [yamlContent]);

  return result;
}

/**
 * Hook for validation error navigation
 * Helps navigate between errors in the editor
 */
export function useValidationNavigation(errors: ValidationError[]) {
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const currentError = errors[currentIndex] ?? null;
  const hasErrors = errors.length > 0;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < errors.length - 1;

  const goToNext = React.useCallback(() => {
    if (hasNext) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [hasNext]);

  const goToPrevious = React.useCallback(() => {
    if (hasPrevious) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [hasPrevious]);

  const goToError = React.useCallback((index: number) => {
    if (index >= 0 && index < errors.length) {
      setCurrentIndex(index);
    }
  }, [errors.length]);

  // Reset index when errors change
  React.useEffect(() => {
    setCurrentIndex(0);
  }, [errors.length]);

  return {
    currentError,
    currentIndex,
    totalErrors: errors.length,
    hasErrors,
    hasPrevious,
    hasNext,
    goToNext,
    goToPrevious,
    goToError,
  };
}

// ============================================================================
// Export
// ============================================================================

export default useMissionValidation;
