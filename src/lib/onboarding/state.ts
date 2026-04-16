/**
 * Onboarding State Utilities
 *
 * Manages onboarding state persistence with Redis primary storage
 * and localStorage fallback for offline support.
 */

import type { OnboardingState, SetupTask, WizardStep, WizardStepId } from '@/src/types/onboarding';
import { DEFAULT_SETUP_TASKS, ONBOARDING_STATE_VERSION } from '@/src/types/onboarding';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'gibson:onboarding:state';
const STATE_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

export interface PersistedOnboardingState extends OnboardingState {
  /** State schema version for migrations */
  _version: number;
  /** Last modified timestamp */
  _lastModified: string;
  /** User ID (for validation) */
  _userId?: string;
}

export interface StateUpdatePayload {
  /** Partial state updates */
  updates: Partial<OnboardingState>;
  /** User ID for scoping */
  userId?: string;
}

export interface StateSyncResult {
  /** Whether sync succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Synced state */
  state?: OnboardingState;
}

// ============================================================================
// localStorage Operations (Fallback)
// ============================================================================

/**
 * Save state to localStorage
 */
export function saveToLocalStorage(state: OnboardingState): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const persisted: PersistedOnboardingState = {
      ...state,
      _version: STATE_VERSION,
      _lastModified: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    return true;
  } catch (error) {
    console.error('[OnboardingState] Failed to save to localStorage:', error);
    return false;
  }
}

/**
 * Load state from localStorage
 */
export function loadFromLocalStorage(): OnboardingState | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as PersistedOnboardingState;

    // Migrate if needed
    const migrated = migrateState(parsed);

    return migrated;
  } catch (error) {
    console.error('[OnboardingState] Failed to load from localStorage:', error);
    return null;
  }
}

/**
 * Clear state from localStorage
 */
export function clearLocalStorage(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[OnboardingState] Failed to clear localStorage:', error);
  }
}

// ============================================================================
// API Operations (Primary Storage)
// ============================================================================

/**
 * Save state to server (Redis)
 */
export async function saveToServer(
  state: OnboardingState,
  userId?: string
): Promise<boolean> {
  try {
    const response = await fetch('/api/onboarding/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...state,
        _version: STATE_VERSION,
        _lastModified: new Date().toISOString(),
        _userId: userId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('[OnboardingState] Failed to save to server:', error);
    return false;
  }
}

/**
 * Load state from server (Redis)
 */
export async function loadFromServer(): Promise<OnboardingState | null> {
  try {
    const response = await fetch('/api/onboarding/status');

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();

    // Migrate if needed
    const migrated = migrateState(data);

    return migrated;
  } catch (error) {
    console.error('[OnboardingState] Failed to load from server:', error);
    return null;
  }
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Sync state between localStorage and server
 * Server state takes precedence if newer
 */
export async function syncState(userId?: string): Promise<StateSyncResult> {
  try {
    // Load from both sources
    const [serverState, localState] = await Promise.all([
      loadFromServer(),
      Promise.resolve(loadFromLocalStorage()),
    ]);

    // If neither exists, return default
    if (!serverState && !localState) {
      const defaultState = createDefaultState();
      return { success: true, state: defaultState };
    }

    // If only server exists, use it and sync to local
    if (serverState && !localState) {
      saveToLocalStorage(serverState);
      return { success: true, state: serverState };
    }

    // If only local exists, sync to server
    if (!serverState && localState) {
      await saveToServer(localState, userId);
      return { success: true, state: localState };
    }

    // Both exist - compare timestamps
    const serverTime = new Date((serverState as PersistedOnboardingState)._lastModified || 0);
    const localTime = new Date((localState as PersistedOnboardingState)._lastModified || 0);

    if (serverTime >= localTime) {
      // Server is newer or equal, sync to local
      saveToLocalStorage(serverState!);
      return { success: true, state: serverState! };
    } else {
      // Local is newer, sync to server
      await saveToServer(localState!, userId);
      return { success: true, state: localState! };
    }
  } catch (error) {
    console.error('[OnboardingState] Sync failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Save state with fallback
 * Tries server first, falls back to localStorage
 */
export async function saveState(
  state: OnboardingState,
  userId?: string
): Promise<boolean> {
  // Always save to localStorage first (instant)
  saveToLocalStorage(state);

  // Then try server (async)
  const serverSuccess = await saveToServer(state, userId);

  return serverSuccess;
}

/**
 * Load state with fallback
 * Tries server first, falls back to localStorage
 */
export async function loadState(): Promise<OnboardingState> {
  // Try server first
  const serverState = await loadFromServer();
  if (serverState) {
    // Sync to localStorage
    saveToLocalStorage(serverState);
    return serverState;
  }

  // Fall back to localStorage
  const localState = loadFromLocalStorage();
  if (localState) {
    return localState;
  }

  // Return default state
  return createDefaultState();
}

// ============================================================================
// State Creation & Defaults
// ============================================================================

/**
 * Create default onboarding state
 */
export function createDefaultState(): OnboardingState {
  return {
    userId: '',
    tenantId: '',
    wizardCompleted: false,
    wizardSkipped: false,
    currentStepId: 'welcome',
    completedSteps: [],
    skippedSteps: [],
    llmConfig: undefined,
    selectedAgentId: undefined,
    createdMissionId: undefined,
    setupTasks: [...DEFAULT_SETUP_TASKS],
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    version: ONBOARDING_STATE_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create setup tasks from onboarding state, merging live status into defaults
 */
export function createSetupTasks(state: OnboardingState): SetupTask[] {
  // Determine task statuses based on state
  const taskStatusOverrides: Partial<Record<string, 'completed' | 'pending'>> = {
    configure_llm: state.llmConfig ? 'completed' : 'pending',
    select_agent: state.selectedAgentId ? 'completed' : 'pending',
    create_mission: state.createdMissionId ? 'completed' : 'pending',
  };

  return DEFAULT_SETUP_TASKS.map((task) => {
    const override = taskStatusOverrides[task.id];
    if (override) {
      return { ...task, status: override };
    }
    // Find from state's setupTasks if present
    const stateTask = state.setupTasks?.find((t) => t.id === task.id);
    return stateTask ?? task;
  });
}

/**
 * Calculate setup progress percentage
 */
export function calculateProgress(state: OnboardingState): number {
  const tasks = createSetupTasks(state);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  return Math.round((completed / tasks.length) * 100);
}

// ============================================================================
// State Migration
// ============================================================================

/**
 * Migrate state from older versions
 */
function migrateState(persisted: PersistedOnboardingState): OnboardingState {
  const version = persisted._version || 0;

  // Clone to avoid mutating
  let state = { ...persisted };

  // Version 0 -> 1: Add new fields
  if (version < 1) {
    state = {
      ...createDefaultState(),
      ...state,
      _version: 1,
    };
  }

  // Remove internal fields before returning
  const { _version, _lastModified, _userId, ...cleanState } = state;

  return cleanState as OnboardingState;
}

// ============================================================================
// State Validation
// ============================================================================

/**
 * Validate state integrity
 */
export function validateState(state: unknown): state is OnboardingState {
  if (!state || typeof state !== 'object') return false;

  const s = state as Record<string, unknown>;

  // Required fields
  if (typeof s.wizardCompleted !== 'boolean') return false;
  if (!Array.isArray(s.completedSteps)) return false;
  if (typeof s.startedAt !== 'string') return false;

  return true;
}

/**
 * Repair invalid state
 */
export function repairState(state: Partial<OnboardingState>): OnboardingState {
  const defaults = createDefaultState();

  return {
    userId: state.userId ?? defaults.userId,
    tenantId: state.tenantId ?? defaults.tenantId,
    wizardCompleted: typeof state.wizardCompleted === 'boolean' ? state.wizardCompleted : defaults.wizardCompleted,
    wizardSkipped: typeof state.wizardSkipped === 'boolean' ? state.wizardSkipped : defaults.wizardSkipped,
    currentStepId: state.currentStepId ?? defaults.currentStepId,
    completedSteps: Array.isArray(state.completedSteps) ? state.completedSteps : defaults.completedSteps,
    skippedSteps: Array.isArray(state.skippedSteps) ? state.skippedSteps : defaults.skippedSteps,
    llmConfig: state.llmConfig ?? defaults.llmConfig,
    selectedAgentId: state.selectedAgentId ?? defaults.selectedAgentId,
    createdMissionId: state.createdMissionId ?? defaults.createdMissionId,
    setupTasks: Array.isArray(state.setupTasks) ? state.setupTasks : defaults.setupTasks,
    startedAt: state.startedAt ?? defaults.startedAt,
    completedAt: state.completedAt ?? defaults.completedAt,
    version: typeof state.version === 'number' ? state.version : defaults.version,
    updatedAt: state.updatedAt ?? defaults.updatedAt,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  saveToLocalStorage,
  loadFromLocalStorage,
  clearLocalStorage,
  saveToServer,
  loadFromServer,
  syncState,
  saveState,
  loadState,
  createDefaultState,
  createSetupTasks,
  calculateProgress,
  validateState,
  repairState,
};
