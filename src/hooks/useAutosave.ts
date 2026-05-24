/**
 * useAutosave Hook
 *
 * Debounced autosave to localStorage.
 * Features:
 * - 30-second debounce
 * - Tenant/user prefix isolation
 * - Storage quota error handling
 * - Clear on successful submission
 */

'use client';

import * as React from 'react';

// ============================================================================
// Types
// ============================================================================

export interface AutosaveData {
  cueSource: string;
  activeTab: string;
  savedAt: string;
  metadata?: {
    name?: string;
    templateId?: string;
  };
}

export interface UseAutosaveOptions {
  /** Unique key for this draft (usually mission type + tenant + user) */
  storageKey: string;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Whether autosave is enabled */
  enabled?: boolean;
}

export interface UseAutosaveReturn {
  /** Current autosave status */
  status: 'idle' | 'saving' | 'saved' | 'error';
  /** Last saved timestamp */
  lastSaved: Date | null;
  /** Error message if status is 'error' */
  error: string | null;
  /** Trigger immediate save */
  save: () => void;
  /** Clear saved draft */
  clear: () => void;
  /** Load existing draft */
  load: () => AutosaveData | null;
  /** Check if draft exists */
  hasDraft: () => boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 30000; // 30 seconds
const STORAGE_PREFIX = 'gibson:draft:';

// ============================================================================
// Hook
// ============================================================================

export function useAutosave(
  data: AutosaveData,
  options: UseAutosaveOptions
): UseAutosaveReturn {
  const { storageKey, debounceMs = DEFAULT_DEBOUNCE_MS, enabled = true } = options;

  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const fullKey = `${STORAGE_PREFIX}${storageKey}`;

  // Save function
  const save = React.useCallback(() => {
    if (!enabled) return;

    setStatus('saving');
    setError(null);

    try {
      const saveData: AutosaveData = {
        ...data,
        savedAt: new Date().toISOString(),
      };

      localStorage.setItem(fullKey, JSON.stringify(saveData));
      setStatus('saved');
      setLastSaved(new Date());
    } catch (err) {
      // Handle quota exceeded
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        setStatus('error');
        setError('Storage quota exceeded. Please clear some space.');

        // Try to clear old drafts
        try {
          clearOldDrafts();
          // Retry save
          localStorage.setItem(fullKey, JSON.stringify(data));
          setStatus('saved');
          setLastSaved(new Date());
          setError(null);
        } catch {
          // Still failed
        }
      } else {
        setStatus('error');
        setError('Failed to save draft');
      }
    }
  }, [data, fullKey, enabled]);

  // Clear function
  const clear = React.useCallback(() => {
    try {
      localStorage.removeItem(fullKey);
      setStatus('idle');
      setLastSaved(null);
    } catch {
      // localStorage.removeItem can fail in private-browsing quota situations
    }
  }, [fullKey]);

  // Load function
  const load = React.useCallback((): AutosaveData | null => {
    try {
      const stored = localStorage.getItem(fullKey);
      if (!stored) return null;

      const parsed = JSON.parse(stored) as AutosaveData;

      // Validate saved data
      if (!parsed.cueSource || typeof parsed.cueSource !== 'string') {
        return null;
      }

      // Update last saved from stored data
      if (parsed.savedAt) {
        setLastSaved(new Date(parsed.savedAt));
      }

      return parsed;
    } catch {
      return null;
    }
  }, [fullKey]);

  // Check if draft exists
  const hasDraft = React.useCallback((): boolean => {
    try {
      return localStorage.getItem(fullKey) !== null;
    } catch {
      return false;
    }
  }, [fullKey]);

  // Debounced autosave effect
  React.useEffect(() => {
    if (!enabled || !data.cueSource) return;

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      save();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data.cueSource, data.activeTab, debounceMs, enabled, save]);

  // Load existing draft on mount
  React.useEffect(() => {
    const existing = load();
    if (existing?.savedAt) {
      setLastSaved(new Date(existing.savedAt));
      setStatus('saved');
    }
  }, []);

  return {
    status,
    lastSaved,
    error,
    save,
    clear,
    load,
    hasDraft,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Clear old drafts to free up space
 */
function clearOldDrafts(): void {
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

  try {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith(STORAGE_PREFIX)
    );

    for (const key of keys) {
      const data = localStorage.getItem(key);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        const savedAt = new Date(parsed.savedAt).getTime();

        if (now - savedAt > maxAge) {
          localStorage.removeItem(key);
        }
      } catch {
        // Invalid data, remove it
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage iteration failed; skip cleanup
  }
}

/**
 * Get all drafts for a user/tenant
 */
export function getAllDrafts(prefix: string): AutosaveData[] {
  const drafts: AutosaveData[] = [];
  const fullPrefix = `${STORAGE_PREFIX}${prefix}`;

  try {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith(fullPrefix)
    );

    for (const key of keys) {
      const data = localStorage.getItem(key);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data) as AutosaveData;
        if (parsed.cueSource) {
          drafts.push(parsed);
        }
      } catch {
        // Skip invalid data
      }
    }
  } catch {
    // localStorage iteration failed; return empty list
  }

  // Sort by saved date, newest first
  return drafts.sort((a, b) => {
    const aTime = new Date(a.savedAt || 0).getTime();
    const bTime = new Date(b.savedAt || 0).getTime();
    return bTime - aTime;
  });
}

// ============================================================================
// Export
// ============================================================================

export default useAutosave;
