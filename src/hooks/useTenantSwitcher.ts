'use client';

/**
 * useTenantSwitcher Hook
 * Manages tenant switcher UI logic including search filtering, keyboard navigation, and error handling
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTenant } from './useTenant';
import type { Tenant } from '@/src/types/tenant';

// ============================================================================
// Types
// ============================================================================

export interface UseTenantSwitcherOptions {
  /** Callback when tenant is successfully switched */
  onSwitchSuccess?: (tenant: Tenant) => void;
  /** Callback when tenant switch fails */
  onSwitchError?: (error: Error) => void;
  /** Enable fuzzy search (default: true for 10+ tenants) */
  enableFuzzySearch?: boolean;
}

export interface UseTenantSwitcherReturn {
  // State
  isOpen: boolean;
  searchQuery: string;
  filteredTenants: Tenant[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;

  // Actions
  openSwitcher: () => void;
  closeSwitcher: () => void;
  toggleSwitcher: () => void;
  handleSearch: (query: string) => void;
  handleKeyboardNav: (event: React.KeyboardEvent) => void;
  selectTenant: (tenantId: string) => Promise<void>;
  selectCurrentHighlighted: () => Promise<void>;
  resetSearch: () => void;
}

// ============================================================================
// Fuzzy Search Implementation
// ============================================================================

/**
 * Simple fuzzy search that matches characters in order but not necessarily contiguous
 */
function fuzzyMatch(text: string, pattern: string): boolean {
  if (!pattern) return true;

  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();

  let patternIdx = 0;

  for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIdx]) {
      patternIdx++;
    }
  }

  return patternIdx === patternLower.length;
}

/**
 * Score a fuzzy match (higher is better)
 */
function fuzzyScore(text: string, pattern: string): number {
  if (!pattern) return 0;

  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();

  let score = 0;
  let consecutive = 0;
  let patternIdx = 0;

  // Exact match at start is best
  if (textLower.startsWith(patternLower)) {
    return 1000 + patternLower.length;
  }

  // Starts with pattern word is good
  if (textLower.includes(patternLower)) {
    score += 500;
  }

  for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIdx]) {
      score += 10;
      consecutive++;
      score += consecutive * 5; // Bonus for consecutive matches
      patternIdx++;
    } else {
      consecutive = 0;
    }
  }

  return score;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useTenantSwitcher(
  options: UseTenantSwitcherOptions = {}
): UseTenantSwitcherReturn {
  const {
    onSwitchSuccess,
    onSwitchError,
    enableFuzzySearch,
  } = options;

  // Get tenant state and actions
  const {
    currentTenant,
    availableTenants,
    switchTenant,
    isLoading,
    error,
    canSwitchTenant,
  } = useTenant();

  // Local UI state
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Ref for tracking if we should use fuzzy search
  const useFuzzy = enableFuzzySearch ?? availableTenants.length >= 10;

  // Filter and sort tenants based on search query
  const filteredTenants = useMemo(() => {
    if (!searchQuery.trim()) {
      // When no search, return all tenants with current tenant first
      return [...availableTenants].sort((a, b) => {
        if (a.id === currentTenant?.id) return -1;
        if (b.id === currentTenant?.id) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
    }

    const query = searchQuery.trim();

    // Filter tenants that match
    const matches = availableTenants.filter((tenant) => {
      if (useFuzzy) {
        return (
          fuzzyMatch(tenant.displayName, query) ||
          fuzzyMatch(tenant.name, query) ||
          (tenant.description && fuzzyMatch(tenant.description, query))
        );
      }

      // Simple substring search
      const lowerQuery = query.toLowerCase();
      return (
        tenant.displayName.toLowerCase().includes(lowerQuery) ||
        tenant.name.toLowerCase().includes(lowerQuery) ||
        (tenant.description?.toLowerCase().includes(lowerQuery) ?? false)
      );
    });

    // Sort by match quality
    if (useFuzzy) {
      return matches.sort((a, b) => {
        const scoreA = Math.max(
          fuzzyScore(a.displayName, query),
          fuzzyScore(a.name, query)
        );
        const scoreB = Math.max(
          fuzzyScore(b.displayName, query),
          fuzzyScore(b.name, query)
        );
        return scoreB - scoreA;
      });
    }

    return matches.sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [availableTenants, searchQuery, currentTenant?.id, useFuzzy]);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredTenants.length, searchQuery]);

  // Open the switcher
  const openSwitcher = useCallback(() => {
    setIsOpen(true);
    setSearchQuery('');
    setSelectedIndex(0);
  }, []);

  // Close the switcher
  const closeSwitcher = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setSelectedIndex(0);
  }, []);

  // Toggle the switcher
  const toggleSwitcher = useCallback(() => {
    if (isOpen) {
      closeSwitcher();
    } else {
      openSwitcher();
    }
  }, [isOpen, openSwitcher, closeSwitcher]);

  // Handle search input
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Reset search
  const resetSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedIndex(0);
  }, []);

  // Select a tenant
  const selectTenant = useCallback(
    async (tenantId: string) => {
      // Check if we can switch
      if (!canSwitchTenant(tenantId)) {
        return;
      }

      try {
        await switchTenant(tenantId);

        // Find the tenant for callback
        const tenant = availableTenants.find((t) => t.id === tenantId);

        if (tenant && onSwitchSuccess) {
          onSwitchSuccess(tenant);
        }

        closeSwitcher();
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        if (onSwitchError) {
          onSwitchError(error);
        }
        // Don't close on error - let user retry
      }
    },
    [
      canSwitchTenant,
      switchTenant,
      availableTenants,
      onSwitchSuccess,
      onSwitchError,
      closeSwitcher,
    ]
  );

  // Select the currently highlighted tenant
  const selectCurrentHighlighted = useCallback(async () => {
    const tenant = filteredTenants[selectedIndex];
    if (tenant) {
      await selectTenant(tenant.id);
    }
  }, [filteredTenants, selectedIndex, selectTenant]);

  // Keyboard navigation handler
  const handleKeyboardNav = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredTenants.length - 1 ? prev + 1 : prev
          );
          break;

        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;

        case 'Enter':
          event.preventDefault();
          selectCurrentHighlighted();
          break;

        case 'Escape':
          event.preventDefault();
          closeSwitcher();
          break;

        case 'Home':
          event.preventDefault();
          setSelectedIndex(0);
          break;

        case 'End':
          event.preventDefault();
          setSelectedIndex(filteredTenants.length - 1);
          break;

        case 'Tab':
          // Allow default tab behavior but close switcher
          closeSwitcher();
          break;
      }
    },
    [isOpen, filteredTenants.length, selectCurrentHighlighted, closeSwitcher]
  );

  return {
    // State
    isOpen,
    searchQuery,
    filteredTenants,
    selectedIndex,
    isLoading,
    error,

    // Actions
    openSwitcher,
    closeSwitcher,
    toggleSwitcher,
    handleSearch,
    handleKeyboardNav,
    selectTenant,
    selectCurrentHighlighted,
    resetSearch,
  };
}
