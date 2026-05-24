/**
 * useMissionCreation Hook
 *
 * Main orchestration hook for mission creation flow.
 * Features:
 * - YAML state management
 * - Validation integration
 * - Template loading
 * - Mission submission
 * - Draft management
 */

'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import { useMissionCreationStore } from '@/src/stores/missionCreationStore';
import { useMissionValidation } from './useMissionValidation';
import { useMissionTemplate, useMissionTemplates } from './useMissionTemplates';
import { substituteVariables } from '@/src/lib/mission/templates';
import type {
  MissionCreationState,
  MissionTemplate,
  SubmissionState,
  CreateMissionRequest,
  CreateMissionResponse,
  ValidationError,
  ValidationWarning,
  MissionCreationTab,
} from '@/src/types/mission-creation';
import type { ValidationResult } from '@/src/hooks/useMissionValidation';

// ============================================================================
// Types
// ============================================================================

export interface UseMissionCreationOptions {
  /** Initial template ID to load */
  templateId?: string | null;
  /** Mission ID to clone from */
  cloneFromId?: string | null;
  /** User ID for drafts */
  userId?: string;
  /** Tenant ID for drafts */
  tenantId?: string;
}

export interface UseMissionCreationReturn {
  /** Current YAML content */
  yamlContent: string;
  /** Update YAML content */
  setYamlContent: (yaml: string) => void;
  /** Current validation state */
  validation: {
    isValidating: boolean;
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  };
  /** Trigger validation */
  validate: () => void;
  /** Current submission state */
  submissionState: SubmissionState;
  /** Submit mission */
  submitMission: (startImmediately: boolean) => void;
  /** Load template */
  loadTemplate: (template: MissionTemplate, variables?: Record<string, unknown>) => void;
  /** Current active tab */
  activeTab: MissionCreationTab;
  /** Set active tab */
  setActiveTab: (tab: MissionCreationTab) => void;
  /** Whether content is dirty */
  isDirty: boolean;
  /** Reset to initial state */
  reset: () => void;
  /** Save draft */
  saveDraft: () => Promise<string>;
  /** Sync visual state to YAML */
  syncToYAML: () => void;
  /** Sync YAML to visual state */
  syncFromYAML: () => void;
  /** Store state */
  state: MissionCreationState;
}

// ============================================================================
// Hook
// ============================================================================

export function useMissionCreation(
  options: UseMissionCreationOptions = {}
): UseMissionCreationReturn {
  const { templateId, cloneFromId, userId, tenantId: optionsTenantId } = options;
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = optionsTenantId ?? currentTenant?.id ?? '';

  // Store access
  const store = useMissionCreationStore();
  const {
    yamlContent,
    updateYaml,
    activeTab,
    setActiveTab,
    isDirty,
    resetState,
    loadTemplate: storeLoadTemplate,
    validationErrors,
    validationWarnings,
    isValid,
    setValidationErrors,
    setValidationWarnings,
  } = store;

  // Validation
  const { validate, isValidating } = useMissionValidation({
    debounceMs: 300,
    onValidationComplete: (result: ValidationResult) => {
      setValidationErrors(result.errors);
      setValidationWarnings(result.warnings);
    },
  });

  // Submission state
  const [submissionState, setSubmissionState] = React.useState<SubmissionState>({
    isSubmitting: false,
    isSuccess: false,
    error: null,
    missionId: null,
  });

  // Template loading
  const { template: loadedTemplate } = useMissionTemplate(templateId);

  // Load template on mount if provided
  React.useEffect(() => {
    if (loadedTemplate && !isDirty) {
      handleLoadTemplate(loadedTemplate);
    }
  }, [loadedTemplate]);

  // Clone mission on mount if provided
  React.useEffect(() => {
    if (cloneFromId && !isDirty) {
      fetchCloneMission(cloneFromId);
    }
  }, [cloneFromId]);

  // Submission mutation
  const submitMutation = useMutation({
    mutationFn: async (params: { yaml: string; startImmediately: boolean }) => {
      const response = await fetch('/api/missions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yaml: params.yaml,
          startImmediately: params.startImmediately,
        } satisfies CreateMissionRequest),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create mission');
      }

      return response.json() as Promise<CreateMissionResponse>;
    },
    onMutate: () => {
      setSubmissionState({
        isSubmitting: true,
        isSuccess: false,
        error: null,
        missionId: null,
      });
    },
    onSuccess: (data) => {
      setSubmissionState({
        isSubmitting: false,
        isSuccess: true,
        error: null,
        missionId: data.missionId || null,
      });
      // Invalidate missions list scoped to current tenant
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.lists(tenantId) });
    },
    onError: (error: Error) => {
      setSubmissionState({
        isSubmitting: false,
        isSuccess: false,
        error: error.message,
        missionId: null,
      });
    },
  });

  // Draft save mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (yaml: string) => {
      const response = await fetch('/api/missions/create', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml, userId, tenantId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save draft');
      }

      return response.json();
    },
  });

  // Load template handler
  const handleLoadTemplate = React.useCallback(
    (template: MissionTemplate, variables?: Record<string, unknown>) => {
      let yamlContent = template.yamlContent;

      // Substitute variables if provided
      if (variables && template.variables) {
        const result = substituteVariables(yamlContent, variables);
        yamlContent = result.content;
      }

      // Update store
      storeLoadTemplate(template, variables);
      updateYaml(yamlContent);
    },
    [storeLoadTemplate, updateYaml]
  );

  // Clone mission fetch
  const fetchCloneMission = React.useCallback(async (missionId: string) => {
    try {
      const response = await fetch(`/api/missions/${missionId}/clone`);
      if (!response.ok) {
        throw new Error('Failed to fetch mission for cloning');
      }

      const data = await response.json();
      let yamlContent = data.yaml;

      // Modify name to indicate it's a copy
      yamlContent = yamlContent.replace(
        /^name:\s*(.+)$/m,
        (match: string, name: string) => `name: ${name.trim()} (Copy)`
      );

      updateYaml(yamlContent);
    } catch {
      // Clone parse error — leave YAML unchanged
    }
  }, [updateYaml]);

  // Submit mission handler
  const submitMission = React.useCallback(
    (startImmediately: boolean) => {
      submitMutation.mutate({ yaml: yamlContent, startImmediately });
    },
    [yamlContent, submitMutation]
  );

  // Save draft handler
  const saveDraft = React.useCallback(async (): Promise<string> => {
    const result = await saveDraftMutation.mutateAsync(yamlContent);
    return result.draftId;
  }, [yamlContent, saveDraftMutation]);

  // Sync to CUE from visual state — no-op now that CUE is the source of truth.
  // The visual builder writes to the store directly; the CUE editor is the
  // canonical authoring surface. This stub preserves the return-type contract.
  const syncToYAML = React.useCallback(() => {
    // no-op: CUE source is authoritative; visual builder is read-only display
  }, []);

  // Sync from CUE to visual state — no-op for the same reason.
  const syncFromYAML = React.useCallback(() => {
    // no-op: CUE parsing runs server-side (ValidateMissionCUE / daemon)
  }, []);

  // Reset handler
  const reset = React.useCallback(() => {
    resetState();
    setSubmissionState({
      isSubmitting: false,
      isSuccess: false,
      error: null,
      missionId: null,
    });
  }, [resetState]);

  return {
    yamlContent,
    setYamlContent: updateYaml,
    validation: {
      isValidating,
      isValid,
      errors: validationErrors,
      warnings: validationWarnings,
    },
    validate,
    submissionState,
    submitMission,
    loadTemplate: handleLoadTemplate,
    activeTab,
    setActiveTab,
    isDirty,
    reset,
    saveDraft,
    syncToYAML,
    syncFromYAML,
    state: store as MissionCreationState,
  };
}

// ============================================================================
// Export
// ============================================================================

export default useMissionCreation;
