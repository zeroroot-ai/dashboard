/**
 * Mission Creation Store Tests
 *
 * Unit tests for the mission creation Zustand store.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useMissionCreationStore,
  selectYamlContent,
  selectMetadata,
  selectScope,
  selectWorkflow,
  selectGuardrails,
  selectValidation,
  selectUIState,
  selectCanSubmit,
} from '../missionCreationStore';
import {
  DEFAULT_CREATION_STATE,
  DEFAULT_METADATA,
  DEFAULT_SCOPE,
  STARTER_YAML,
} from '@/src/types/mission-creation';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-12345',
});

// Reset store before each test
beforeEach(() => {
  const store = useMissionCreationStore.getState();
  store.resetState();
  localStorageMock.setItem.mockClear();
  localStorageMock.getItem.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MissionCreationStore', () => {
  describe('Initial State', () => {
    it('should have default initial state', () => {
      const state = useMissionCreationStore.getState();

      expect(state.activeTab).toBe('yaml');
      expect(state.isDirty).toBe(false);
      expect(state.isValid).toBe(false);
      expect(state.validationErrors).toEqual([]);
      expect(state.validationWarnings).toEqual([]);
    });

    it('should have starter YAML content after reset', () => {
      const state = useMissionCreationStore.getState();

      expect(state.yamlContent).toBe(STARTER_YAML);
    });

    it('should have default metadata', () => {
      const state = useMissionCreationStore.getState();

      expect(state.metadata.name).toBe(DEFAULT_METADATA.name);
      expect(state.metadata.tags).toEqual(DEFAULT_METADATA.tags);
      expect(state.metadata.priority).toBe(DEFAULT_METADATA.priority);
    });

    it('should have default scope', () => {
      const state = useMissionCreationStore.getState();

      expect(state.scope.seeds).toEqual(DEFAULT_SCOPE.seeds);
      expect(state.scope.expansionMode).toBe(DEFAULT_SCOPE.expansionMode);
    });
  });

  describe('YAML Actions', () => {
    it('should update YAML content', () => {
      const { updateYaml } = useMissionCreationStore.getState();

      act(() => {
        updateYaml('name: new-mission\n');
      });

      const state = useMissionCreationStore.getState();
      expect(state.yamlContent).toBe('name: new-mission\n');
    });

    it('should mark state as dirty when YAML is updated', () => {
      const { updateYaml } = useMissionCreationStore.getState();

      act(() => {
        updateYaml('name: updated-mission');
      });

      const state = useMissionCreationStore.getState();
      expect(state.isDirty).toBe(true);
    });
  });

  describe('Metadata Actions', () => {
    it('should update metadata partially', () => {
      const { updateMetadata } = useMissionCreationStore.getState();

      act(() => {
        updateMetadata({ name: 'test-mission' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.metadata.name).toBe('test-mission');
      // Other fields should remain unchanged
      expect(state.metadata.tags).toEqual(DEFAULT_METADATA.tags);
    });

    it('should update metadata tags', () => {
      const { updateMetadata } = useMissionCreationStore.getState();

      act(() => {
        updateMetadata({ tags: ['security', 'api'] });
      });

      const state = useMissionCreationStore.getState();
      expect(state.metadata.tags).toEqual(['security', 'api']);
    });

    it('should update metadata priority', () => {
      const { updateMetadata } = useMissionCreationStore.getState();

      act(() => {
        updateMetadata({ priority: 'high' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.metadata.priority).toBe('high');
    });

    it('should mark state as dirty when metadata is updated', () => {
      const { updateMetadata } = useMissionCreationStore.getState();

      act(() => {
        updateMetadata({ name: 'test' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.isDirty).toBe(true);
    });
  });

  describe('Scope Actions', () => {
    it('should update scope configuration', () => {
      const { updateScope } = useMissionCreationStore.getState();

      act(() => {
        updateScope({ expansionMode: 'subdomain' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.scope.expansionMode).toBe('subdomain');
    });

    it('should update scope seeds', () => {
      const { updateScope } = useMissionCreationStore.getState();
      const newSeeds = [
        { id: '1', type: 'url' as const, value: 'https://example.com', isValid: true },
      ];

      act(() => {
        updateScope({ seeds: newSeeds });
      });

      const state = useMissionCreationStore.getState();
      expect(state.scope.seeds).toHaveLength(1);
      expect(state.scope.seeds[0].value).toBe('https://example.com');
    });

    it('should update max depth', () => {
      const { updateScope } = useMissionCreationStore.getState();

      act(() => {
        updateScope({ maxDepth: 5 });
      });

      const state = useMissionCreationStore.getState();
      expect(state.scope.maxDepth).toBe(5);
    });
  });

  describe('Workflow Actions', () => {
    it('should update workflow configuration', () => {
      const { updateWorkflow } = useMissionCreationStore.getState();
      const newSteps = [
        {
          id: 'step-1',
          name: 'Recon',
          type: 'agent' as const,
          config: { type: 'agent' as const, agentId: 'recon-agent', task: 'Scan target' },
        },
      ];

      act(() => {
        updateWorkflow({ steps: newSteps });
      });

      const state = useMissionCreationStore.getState();
      expect(state.workflow.steps).toHaveLength(1);
      expect(state.workflow.steps[0].name).toBe('Recon');
    });

    it('should update error handling mode', () => {
      const { updateWorkflow } = useMissionCreationStore.getState();

      act(() => {
        updateWorkflow({ errorHandling: 'stop' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.workflow.errorHandling).toBe('stop');
    });
  });

  describe('Guardrails Actions', () => {
    it('should update guardrails configuration', () => {
      const { updateGuardrails } = useMissionCreationStore.getState();

      act(() => {
        updateGuardrails({ maxTokensPerCall: 50000 });
      });

      const state = useMissionCreationStore.getState();
      expect(state.guardrails.maxTokensPerCall).toBe(50000);
    });

    it('should update allowed agents', () => {
      const { updateGuardrails } = useMissionCreationStore.getState();

      act(() => {
        updateGuardrails({ allowedAgents: ['recon-agent', 'api-mapper'] });
      });

      const state = useMissionCreationStore.getState();
      expect(state.guardrails.allowedAgents).toEqual(['recon-agent', 'api-mapper']);
    });

    it('should update blocked agents', () => {
      const { updateGuardrails } = useMissionCreationStore.getState();

      act(() => {
        updateGuardrails({ blockedAgents: ['dangerous-agent'] });
      });

      const state = useMissionCreationStore.getState();
      expect(state.guardrails.blockedAgents).toEqual(['dangerous-agent']);
    });

    it('should update rate limits', () => {
      const { updateGuardrails } = useMissionCreationStore.getState();

      act(() => {
        updateGuardrails({
          rateLimits: {
            requestsPerMinute: 100,
            requestsPerHour: 1000,
          },
        });
      });

      const state = useMissionCreationStore.getState();
      const rateLimits = state.guardrails.rateLimits as { requestsPerMinute?: number } | undefined;
      expect(rateLimits?.requestsPerMinute).toBe(100);
    });
  });

  describe('Validation Actions', () => {
    it('should set validation errors', () => {
      const { setValidationErrors } = useMissionCreationStore.getState();
      const errors = [
        { path: 'name', message: 'Name is required', severity: 'error' as const },
      ];

      act(() => {
        setValidationErrors(errors);
      });

      const state = useMissionCreationStore.getState();
      expect(state.validationErrors).toHaveLength(1);
      expect(state.validationErrors[0].message).toBe('Name is required');
      expect(state.isValid).toBe(false);
    });

    it('should set isValid to true when no errors', () => {
      const { setValidationErrors } = useMissionCreationStore.getState();

      act(() => {
        setValidationErrors([]);
      });

      const state = useMissionCreationStore.getState();
      expect(state.isValid).toBe(true);
    });

    it('should set validation warnings', () => {
      const { setValidationWarnings } = useMissionCreationStore.getState();
      const warnings = [
        { path: 'scope', message: 'No targets defined', severity: 'warning' as const },
      ];

      act(() => {
        setValidationWarnings(warnings);
      });

      const state = useMissionCreationStore.getState();
      expect(state.validationWarnings).toHaveLength(1);
    });
  });

  describe('UI State Actions', () => {
    it('should set active tab', () => {
      const { setActiveTab } = useMissionCreationStore.getState();

      act(() => {
        setActiveTab('metadata');
      });

      const state = useMissionCreationStore.getState();
      expect(state.activeTab).toBe('metadata');
    });

    it('should mark state as dirty', () => {
      const { markDirty } = useMissionCreationStore.getState();

      act(() => {
        markDirty();
      });

      const state = useMissionCreationStore.getState();
      expect(state.isDirty).toBe(true);
    });

    it('should mark state as clean', () => {
      const { markDirty, markClean } = useMissionCreationStore.getState();

      act(() => {
        markDirty();
        markClean();
      });

      const state = useMissionCreationStore.getState();
      expect(state.isDirty).toBe(false);
    });
  });

  describe('Template Actions', () => {
    it('should load template', () => {
      const { loadTemplate } = useMissionCreationStore.getState();
      const template = {
        id: 'template-1',
        name: 'Test Template',
        description: 'A test template',
        yamlContent: 'name: ${NAME}\ndescription: Test',
        category: 'recon' as const,
        difficulty: 'beginner' as const,
        estimatedDuration: '10m',
        variables: [{ name: 'NAME', description: 'Mission name', required: true }],
      };

      act(() => {
        loadTemplate(template, { NAME: 'my-mission' });
      });

      const state = useMissionCreationStore.getState();
      expect(state.yamlContent).toContain('name: my-mission');
      expect(state.sourceTemplateId).toBe('template-1');
      expect(state.isDirty).toBe(false);
    });

    it('should substitute template variables', () => {
      const { loadTemplate } = useMissionCreationStore.getState();
      const template = {
        id: 'template-2',
        name: 'Variable Template',
        description: 'Template with variables',
        yamlContent: 'name: ${NAME}\ntarget: ${TARGET}\nmode: ${MODE}',
        category: 'recon' as const,
        difficulty: 'beginner' as const,
        estimatedDuration: '5m',
      };

      act(() => {
        loadTemplate(template, {
          NAME: 'test-mission',
          TARGET: 'example.com',
          MODE: 'aggressive',
        });
      });

      const state = useMissionCreationStore.getState();
      expect(state.yamlContent).toContain('name: test-mission');
      expect(state.yamlContent).toContain('target: example.com');
      expect(state.yamlContent).toContain('mode: aggressive');
    });

    it('should clear validation on template load', () => {
      const { loadTemplate, setValidationErrors } = useMissionCreationStore.getState();

      // Set some errors first
      act(() => {
        setValidationErrors([{ path: 'name', message: 'Error', severity: 'error' }]);
      });

      // Load template
      act(() => {
        loadTemplate({
          id: 't1',
          name: 'Template',
          description: 'Test',
          yamlContent: 'name: test',
          category: 'recon',
          difficulty: 'beginner',
          estimatedDuration: '5m',
        });
      });

      const state = useMissionCreationStore.getState();
      expect(state.validationErrors).toEqual([]);
    });
  });

  describe('Draft Actions', () => {
    it('should load draft', () => {
      const { loadDraft } = useMissionCreationStore.getState();
      const draft = {
        id: 'draft-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        name: 'Draft Mission',
        yamlContent: 'name: draft-test\n',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        activeTab: 'scope' as const,
      };

      act(() => {
        loadDraft(draft);
      });

      const state = useMissionCreationStore.getState();
      expect(state.yamlContent).toBe('name: draft-test\n');
      expect(state.draftId).toBe('draft-1');
      expect(state.activeTab).toBe('scope');
      expect(state.isDirty).toBe(false);
    });

    it('should save draft to localStorage', async () => {
      const { updateYaml, updateMetadata, saveDraft } = useMissionCreationStore.getState();

      act(() => {
        updateYaml('name: save-test');
        updateMetadata({ name: 'Save Test' });
      });

      let draftId: string | undefined;
      await act(async () => {
        draftId = await saveDraft();
      });

      expect(draftId).toBeDefined();
      expect(localStorageMock.setItem).toHaveBeenCalled();

      const state = useMissionCreationStore.getState();
      expect(state.draftId).toBe(draftId);
      expect(state.isDirty).toBe(false);
    });
  });

  describe('Reset Action', () => {
    it('should reset all state to defaults', () => {
      const { updateYaml, updateMetadata, updateScope, setActiveTab, resetState } =
        useMissionCreationStore.getState();

      // Make some changes
      act(() => {
        updateYaml('name: custom');
        updateMetadata({ name: 'Custom', tags: ['tag1'] });
        updateScope({ maxDepth: 10 });
        setActiveTab('workflow');
      });

      // Reset
      act(() => {
        resetState();
      });

      const state = useMissionCreationStore.getState();
      expect(state.yamlContent).toBe(STARTER_YAML);
      expect(state.activeTab).toBe('yaml');
      expect(state.isDirty).toBe(false);
    });
  });
});

describe('Selectors', () => {
  it('should select YAML content', () => {
    const { updateYaml } = useMissionCreationStore.getState();

    act(() => {
      updateYaml('name: selector-test');
    });

    const state = useMissionCreationStore.getState();
    expect(selectYamlContent(state)).toBe('name: selector-test');
  });

  it('should select metadata', () => {
    const { updateMetadata } = useMissionCreationStore.getState();

    act(() => {
      updateMetadata({ name: 'Test', description: 'Description' });
    });

    const state = useMissionCreationStore.getState();
    const metadata = selectMetadata(state);
    expect(metadata.name).toBe('Test');
    expect(metadata.description).toBe('Description');
  });

  it('should select scope', () => {
    const { updateScope } = useMissionCreationStore.getState();

    act(() => {
      updateScope({ maxDepth: 7 });
    });

    const state = useMissionCreationStore.getState();
    const scope = selectScope(state);
    expect(scope.maxDepth).toBe(7);
  });

  it('should select workflow', () => {
    const state = useMissionCreationStore.getState();
    const workflow = selectWorkflow(state);
    expect(workflow.steps).toBeDefined();
    expect(workflow.errorHandling).toBeDefined();
  });

  it('should select guardrails', () => {
    const state = useMissionCreationStore.getState();
    const guardrails = selectGuardrails(state);
    expect(guardrails.maxTokensPerCall).toBeDefined();
  });

  it('should select validation state', () => {
    const { setValidationErrors, setValidationWarnings } = useMissionCreationStore.getState();

    act(() => {
      setValidationErrors([{ path: 'name', message: 'Error', severity: 'error' }]);
      setValidationWarnings([{ path: 'scope', message: 'Warning', severity: 'warning' }]);
    });

    const state = useMissionCreationStore.getState();
    const validation = selectValidation(state);
    expect(validation.errors).toHaveLength(1);
    expect(validation.warnings).toHaveLength(1);
    expect(validation.isValid).toBe(false);
  });

  it('should select UI state', () => {
    const { setActiveTab, markDirty } = useMissionCreationStore.getState();

    act(() => {
      setActiveTab('guardrails');
      markDirty();
    });

    const state = useMissionCreationStore.getState();
    const uiState = selectUIState(state);
    expect(uiState.activeTab).toBe('guardrails');
    expect(uiState.isDirty).toBe(true);
  });

  it('should select canSubmit', () => {
    const { updateYaml, setValidationErrors } = useMissionCreationStore.getState();

    // Initially cannot submit (not valid)
    let state = useMissionCreationStore.getState();
    expect(selectCanSubmit(state)).toBe(false);

    // Set valid state
    act(() => {
      updateYaml('name: valid-mission');
      setValidationErrors([]);
    });

    state = useMissionCreationStore.getState();
    expect(selectCanSubmit(state)).toBe(true);

    // With errors, cannot submit
    act(() => {
      setValidationErrors([{ path: 'name', message: 'Error', severity: 'error' }]);
    });

    state = useMissionCreationStore.getState();
    expect(selectCanSubmit(state)).toBe(false);
  });
});
