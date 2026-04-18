/**
 * Mission Creation Zustand Store
 *
 * Centralized state management for the mission creation interface.
 * Manages YAML content, metadata, scope, mission steps, validation, and UI state.
 */

import * as React from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import {
  type MissionCreationState,
  type MissionCreationStore,
  type MissionMetadata,
  type ScopeConfig,
  type MissionConfig,
  type GuardrailsConfig,
  type ValidationError,
  type ValidationWarning,
  type MissionCreationTab,
  type MissionTemplate,
  type DraftMission,
  type ScopeTarget,
  DEFAULT_CREATION_STATE,
  DEFAULT_METADATA,
  DEFAULT_SCOPE,
  DEFAULT_MISSION,
  DEFAULT_GUARDRAILS,
  STARTER_YAML,
} from '@/src/types/mission-creation';

// ============================================================================
// Store Implementation
// ============================================================================

export const useMissionCreationStore = create<MissionCreationStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        // Initial state
        ...DEFAULT_CREATION_STATE,

        // =====================================================================
        // YAML Actions
        // =====================================================================

        updateYaml: (yaml: string) => {
          set((state) => {
            state.yamlContent = yaml;
            state.isDirty = true;
          });
        },

        // =====================================================================
        // Metadata Actions
        // =====================================================================

        updateMetadata: (metadata: Partial<MissionMetadata>) => {
          set((state) => {
            state.metadata = { ...state.metadata, ...metadata };
            state.isDirty = true;
          });
        },

        // =====================================================================
        // Scope Actions
        // =====================================================================

        updateScope: (scope: Partial<ScopeConfig>) => {
          set((state) => {
            state.scope = { ...state.scope, ...scope };
            state.isDirty = true;
          });
        },

        // =====================================================================
        // Mission Actions
        // =====================================================================

        updateMission: (mission: Partial<MissionConfig>) => {
          set((state) => {
            state.mission = { ...state.mission, ...mission };
            state.isDirty = true;
          });
        },

        // =====================================================================
        // Guardrails Actions
        // =====================================================================

        updateGuardrails: (guardrails: Partial<GuardrailsConfig>) => {
          set((state) => {
            state.guardrails = { ...state.guardrails, ...guardrails };
            state.isDirty = true;
          });
        },

        // =====================================================================
        // Validation Actions
        // =====================================================================

        setValidationErrors: (errors: ValidationError[]) => {
          set((state) => {
            state.validationErrors = errors;
            state.isValid = errors.length === 0;
          });
        },

        setValidationWarnings: (warnings: ValidationWarning[]) => {
          set((state) => {
            state.validationWarnings = warnings;
          });
        },

        // =====================================================================
        // UI State Actions
        // =====================================================================

        setActiveTab: (tab: MissionCreationTab) => {
          set((state) => {
            state.activeTab = tab;
          });
        },

        markDirty: () => {
          set((state) => {
            state.isDirty = true;
          });
        },

        markClean: () => {
          set((state) => {
            state.isDirty = false;
          });
        },

        // =====================================================================
        // Reset Action
        // =====================================================================

        resetState: () => {
          set((state) => {
            Object.assign(state, DEFAULT_CREATION_STATE);
            state.yamlContent = STARTER_YAML;
          });
        },

        // =====================================================================
        // Template Actions
        // =====================================================================

        loadTemplate: (template: MissionTemplate, variables?: Record<string, unknown>) => {
          let yaml = template.yamlContent;

          // Substitute variables if provided
          if (variables) {
            Object.entries(variables).forEach(([key, value]) => {
              const placeholder = new RegExp(`\\$\\{${key}\\}`, 'g');
              yaml = yaml.replace(placeholder, String(value));
            });
          }

          set((state) => {
            state.yamlContent = yaml;
            state.sourceTemplateId = template.id;
            state.clonedFromId = null;
            state.isDirty = false;
            state.validationErrors = [];
            state.validationWarnings = [];
            state.isValid = false; // Will be validated
            state.draftId = null;
            state.lastSaved = null;
          });
        },

        // =====================================================================
        // Draft Actions
        // =====================================================================

        loadDraft: (draft: DraftMission) => {
          set((state) => {
            state.yamlContent = draft.yamlContent;
            state.draftId = draft.id;
            state.activeTab = draft.activeTab;
            state.sourceTemplateId = draft.templateId || null;
            state.clonedFromId = draft.clonedFromId || null;
            state.lastSaved = draft.updatedAt;
            state.isDirty = false;
          });
        },

        saveDraft: async () => {
          const state = get();
          const draftId = state.draftId || crypto.randomUUID();

          const draft: DraftMission = {
            id: draftId,
            userId: '', // Will be set by API
            tenantId: '', // Will be set by API
            name: state.metadata.name || 'Untitled Mission',
            yamlContent: state.yamlContent,
            createdAt: state.lastSaved || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            templateId: state.sourceTemplateId || undefined,
            clonedFromId: state.clonedFromId || undefined,
            activeTab: state.activeTab,
          };

          // Save to localStorage as fallback
          try {
            const storageKey = `gibson:mission:draft:${draftId}`;
            localStorage.setItem(storageKey, JSON.stringify(draft));
          } catch (error) {
            console.error('[MissionCreation] Failed to save draft to localStorage:', error);
          }

          set((state) => {
            state.draftId = draftId;
            state.lastSaved = draft.updatedAt;
            state.isDirty = false;
          });

          return draftId;
        },

        // =====================================================================
        // Clone Actions
        // =====================================================================

        loadFromClone: async (missionId: string) => {
          try {
            const response = await fetch(`/api/missions/${missionId}/clone`);
            if (!response.ok) {
              throw new Error('Failed to fetch mission for cloning');
            }

            const data = await response.json();

            set((state) => {
              state.yamlContent = data.yaml;
              state.clonedFromId = missionId;
              state.sourceTemplateId = null;
              state.isDirty = false;
              state.draftId = null;
              state.lastSaved = null;

              // Update name to indicate it's a copy
              if (data.name) {
                const yamlLines = state.yamlContent.split('\n');
                const nameIndex = yamlLines.findIndex((line: string) =>
                  line.trim().startsWith('name:')
                );
                if (nameIndex !== -1) {
                  yamlLines[nameIndex] = `name: ${data.name} (Copy)`;
                  state.yamlContent = yamlLines.join('\n');
                }
              }
            });
          } catch (error) {
            console.error('[MissionCreation] Failed to clone mission:', error);
            throw error;
          }
        },

        // =====================================================================
        // Sync Actions
        // =====================================================================

        syncYamlToState: () => {
          const state = get();
          try {
            const parsed = parseYaml(state.yamlContent) as Record<string, unknown> | null;
            if (!parsed || typeof parsed !== 'object') return;

            set((draft) => {
              // Populate metadata fields from top-level YAML keys
              if (typeof parsed.name === 'string') {
                draft.metadata.name = parsed.name;
              }
              if (typeof parsed.description === 'string') {
                draft.metadata.description = parsed.description;
              }
              if (Array.isArray(parsed.tags)) {
                draft.metadata.tags = parsed.tags.filter(
                  (t): t is string => typeof t === 'string'
                );
              }

              // Populate scope from YAML scope block
              const scope = parsed.scope as Record<string, unknown> | undefined;
              if (scope && typeof scope === 'object') {
                if (Array.isArray(scope.include)) {
                  draft.scope.include = scope.include
                    .filter((v) => typeof v === 'string' || (v && typeof v === 'object'))
                    .map((v) =>
                      typeof v === 'string'
                        ? { type: 'glob' as const, pattern: v }
                        : { type: (v as { type?: string }).type as 'glob' | 'regex' | 'cidr' ?? 'glob', pattern: String((v as { pattern?: unknown }).pattern ?? '') }
                    );
                }
                if (Array.isArray(scope.exclude)) {
                  draft.scope.exclude = scope.exclude
                    .filter((v) => typeof v === 'string' || (v && typeof v === 'object'))
                    .map((v) =>
                      typeof v === 'string'
                        ? { type: 'glob' as const, pattern: v }
                        : { type: (v as { type?: string }).type as 'glob' | 'regex' | 'cidr' ?? 'glob', pattern: String((v as { pattern?: unknown }).pattern ?? '') }
                    );
                }
              }
            });
          } catch (error) {
            console.error('[MissionCreation] Failed to sync YAML to state:', error);
          }
        },

        syncStateToYaml: () => {
          const state = get();
          try {
            // Build a plain object from current state fields
            const doc: Record<string, unknown> = {};

            if (state.metadata.name) doc.name = state.metadata.name;
            if (state.metadata.description) doc.description = state.metadata.description;
            if (state.metadata.tags.length > 0) doc.tags = state.metadata.tags;

            const scope: Record<string, unknown> = {};
            if (state.scope.seeds.length > 0) {
              scope.seeds = state.scope.seeds.map((s) => ({ type: s.type, value: s.value }));
            }
            if (state.scope.include.length > 0) scope.include = state.scope.include;
            if (state.scope.exclude.length > 0) scope.exclude = state.scope.exclude;
            if (Object.keys(scope).length > 0) doc.scope = scope;

            const yaml = stringifyYaml(doc);
            set((draft) => {
              draft.yamlContent = yaml;
              draft.isDirty = true;
            });
          } catch (error) {
            console.error('[MissionCreation] Failed to sync state to YAML:', error);
          }
        },
      })),
      {
        name: 'gibson:mission-creation',
        partialize: (state) => ({
          // Only persist certain fields
          activeTab: state.activeTab,
          // Don't persist sensitive or transient data
        }),
      }
    ),
    {
      name: 'MissionCreationStore',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

/**
 * Select YAML content
 */
export const selectYamlContent = (state: MissionCreationStore) => state.yamlContent;

/**
 * Select metadata
 */
export const selectMetadata = (state: MissionCreationStore) => state.metadata;

/**
 * Select scope configuration
 */
export const selectScope = (state: MissionCreationStore) => state.scope;

/**
 * Select mission configuration
 */
export const selectMission = (state: MissionCreationStore) => state.mission;

/**
 * Select guardrails configuration
 */
export const selectGuardrails = (state: MissionCreationStore) => state.guardrails;

/**
 * Select validation state
 */
export const selectValidation = (state: MissionCreationStore) => ({
  errors: state.validationErrors,
  warnings: state.validationWarnings,
  isValid: state.isValid,
});

/**
 * Select UI state
 */
export const selectUIState = (state: MissionCreationStore) => ({
  activeTab: state.activeTab,
  isDirty: state.isDirty,
  draftId: state.draftId,
  lastSaved: state.lastSaved,
});

/**
 * Select whether mission can be submitted
 */
export const selectCanSubmit = (state: MissionCreationStore) =>
  state.isValid && state.yamlContent.trim().length > 0;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for YAML editor state
 */
export function useYamlEditor() {
  const yamlContent = useMissionCreationStore(selectYamlContent);
  const updateYaml = useMissionCreationStore((state) => state.updateYaml);
  const validation = useMissionCreationStore(
    useShallow((state) => ({
      errors: state.validationErrors,
      warnings: state.validationWarnings,
      isValid: state.isValid,
    }))
  );

  return {
    yamlContent,
    updateYaml,
    ...validation,
  };
}

/**
 * Hook for metadata form
 */
export function useMetadataForm() {
  return useMissionCreationStore(
    useShallow((state) => ({
      metadata: state.metadata,
      updateMetadata: state.updateMetadata,
    }))
  );
}

/**
 * Hook for scope builder
 */
export function useScopeBuilder() {
  const { scope, updateScope } = useMissionCreationStore(
    useShallow((state) => ({
      scope: state.scope,
      updateScope: state.updateScope,
    }))
  );

  const addTarget = React.useCallback((target: Omit<ScopeTarget, 'id'>) => {
    const newTarget: ScopeTarget = {
      ...target,
      id: crypto.randomUUID(),
    };
    updateScope({
      seeds: [...scope.seeds, newTarget],
    });
  }, [scope.seeds, updateScope]);

  const removeTarget = React.useCallback((targetId: string) => {
    updateScope({
      seeds: scope.seeds.filter((t) => t.id !== targetId),
    });
  }, [scope.seeds, updateScope]);

  const updateTarget = React.useCallback((targetId: string, updates: Partial<ScopeTarget>) => {
    updateScope({
      seeds: scope.seeds.map((t) =>
        t.id === targetId ? { ...t, ...updates } : t
      ),
    });
  }, [scope.seeds, updateScope]);

  return {
    scope,
    updateScope,
    addTarget,
    removeTarget,
    updateTarget,
  };
}

/**
 * Hook for mission editor
 */
export function useMissionEditor() {
  return useMissionCreationStore(
    useShallow((state) => ({
      mission: state.mission,
      updateMission: state.updateMission,
    }))
  );
}

/**
 * Hook for guardrails config
 */
export function useGuardrailsConfig() {
  return useMissionCreationStore(
    useShallow((state) => ({
      guardrails: state.guardrails,
      updateGuardrails: state.updateGuardrails,
    }))
  );
}

/**
 * Hook for draft management
 */
export function useDraftManagement() {
  return useMissionCreationStore(
    useShallow((state) => ({
      draftId: state.draftId,
      lastSaved: state.lastSaved,
      isDirty: state.isDirty,
      saveDraft: state.saveDraft,
      loadDraft: state.loadDraft,
    }))
  );
}

/**
 * Hook for tab navigation
 */
export function useCreationTabs() {
  return useMissionCreationStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
    }))
  );
}

// ============================================================================
// Export
// ============================================================================

export default useMissionCreationStore;
