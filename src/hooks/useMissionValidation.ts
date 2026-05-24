/**
 * useMissionValidation Hook
 *
 * Real-time validation hook for mission CUE content.
 * Features:
 * - Debounced server-side CUE validation (300ms default)
 * - Integration with TanStack Query for caching
 * - Automatic validation state management
 */

'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMissionCreationStore } from '@/src/stores/missionCreationStore';
import type { ValidationError, ValidationWarning } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  /** Whether the CUE source is valid */
  isValid: boolean;
  /** Validation errors (must be fixed) */
  errors: ValidationError[];
  /** Validation warnings (suggestions) */
  warnings: ValidationWarning[];
  /** Parsed mission object (if parsing succeeded) — kept for ValidationPanel compat */
  parsed: Record<string, unknown> | null;
  /** Validation duration in ms */
  duration: number;
}

export interface UseMissionValidationOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
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
// Server Validation API (CUE — via /api/missions/validate)
// ============================================================================

async function serverValidate(cueSource: string): Promise<ValidationResult> {
  const response = await fetch('/api/missions/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cueSource }),
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
    autoValidate = true,
    onValidationComplete,
  } = options;

  // Store state — yamlContent field still holds the CUE source (field name
  // preserved for back-compat with the store shape; a rename requires a
  // separate store-schema migration).
  const cueSource = useMissionCreationStore((state) => state.yamlContent);
  const setValidationErrors = useMissionCreationStore((state) => state.setValidationErrors);
  const setValidationWarnings = useMissionCreationStore((state) => state.setValidationWarnings);

  // Local state
  const [lastResult, setLastResult] = React.useState<ValidationResult | null>(null);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = React.useRef<string>('');

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
      try {
        const result = await serverValidationMutation.mutateAsync(content);
        return result;
      } catch {
        // Return a benign "unknown" result on network error; the mutation
        // error state will be visible via serverValidationMutation.error.
        const fallback: ValidationResult = {
          isValid: false,
          errors: [{
            code: 'VALIDATION_UNAVAILABLE',
            message: 'Validation service unavailable — check your connection.',
            path: '',
            severity: 'error',
          }],
          warnings: [],
          parsed: null,
          duration: 0,
        };
        setLastResult(fallback);
        setValidationErrors(fallback.errors);
        setValidationWarnings([]);
        onValidationComplete?.(fallback);
        return fallback;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setValidationErrors, setValidationWarnings, onValidationComplete]
  );

  // Validate current store content
  const validate = React.useCallback(async (): Promise<ValidationResult> => {
    return validateContent(cueSource);
  }, [validateContent, cueSource]);

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
    if (cueSource === lastContentRef.current) return;
    lastContentRef.current = cueSource;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce validation
    debounceTimerRef.current = setTimeout(() => {
      validateContent(cueSource);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [cueSource, autoValidate, debounceMs, validateContent]);

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
