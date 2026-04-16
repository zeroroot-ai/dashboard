'use client';

import * as React from 'react';
import { useOnboardingStore, useWizardNavigation } from '@/src/stores/onboarding-store';
import { WIZARD_STEPS } from '@/src/types/onboarding';

// ============================================================================
// Types
// ============================================================================

export interface KeyboardShortcut {
  /** Key or key combination (e.g., 'Enter', 'Alt+S', 'ArrowRight') */
  key: string;
  /** Description for accessibility */
  description: string;
  /** Action to perform */
  action: () => void;
  /** Whether shortcut is currently enabled */
  enabled: boolean;
  /** Modifier keys required */
  modifiers?: {
    alt?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  };
}

export interface UseWizardKeyboardNavigationOptions {
  /** Whether keyboard navigation is enabled */
  enabled?: boolean;
  /** Callback when advancing to next step */
  onAdvance?: () => void;
  /** Callback when going back to previous step */
  onBack?: () => void;
  /** Callback when skipping wizard */
  onSkip?: () => void;
  /** Callback when opening help */
  onHelp?: () => void;
  /** Custom key handlers */
  customHandlers?: Record<string, () => void>;
}

export interface UseWizardKeyboardNavigationReturn {
  /** All registered keyboard shortcuts */
  shortcuts: KeyboardShortcut[];
  /** Whether keyboard navigation is active */
  isActive: boolean;
  /** Manually trigger a shortcut action */
  triggerShortcut: (key: string) => void;
  /** Formatted shortcuts for display */
  formattedShortcuts: Array<{
    key: string;
    label: string;
    description: string;
  }>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useWizardKeyboardNavigation Hook
 *
 * Provides keyboard navigation for the onboarding wizard.
 * Supports arrow keys, Enter, Escape, and Alt+S for skip.
 */
export function useWizardKeyboardNavigation(
  options: UseWizardKeyboardNavigationOptions = {}
): UseWizardKeyboardNavigationReturn {
  const {
    enabled = true,
    onAdvance,
    onBack,
    onSkip,
    onHelp,
    customHandlers = {},
  } = options;

  const { wizardInProgress, currentStepId: storeCurrentStepId, stepValidation } = useOnboardingStore();
  const { nextStep, previousStep, canAdvance, canGoBack, skipCurrentStep } =
    useWizardNavigation();

  const currentStepId = storeCurrentStepId || 'welcome';
  const isCurrentStepValid = stepValidation[currentStepId] ?? false;

  // Define shortcuts
  const shortcuts = React.useMemo<KeyboardShortcut[]>(
    () => [
      {
        key: 'Enter',
        description: 'Advance to next step',
        action: () => {
          if (canAdvance()) {
            onAdvance?.();
            nextStep();
          }
        },
        enabled: enabled && wizardInProgress && canAdvance(),
      },
      {
        key: 'ArrowRight',
        description: 'Advance to next step',
        action: () => {
          if (canAdvance()) {
            onAdvance?.();
            nextStep();
          }
        },
        enabled: enabled && wizardInProgress && canAdvance(),
      },
      {
        key: 'ArrowLeft',
        description: 'Go back to previous step',
        action: () => {
          if (canGoBack()) {
            onBack?.();
            previousStep();
          }
        },
        enabled: enabled && wizardInProgress && canGoBack(),
      },
      {
        key: 'Backspace',
        description: 'Go back to previous step',
        action: () => {
          if (canGoBack()) {
            onBack?.();
            previousStep();
          }
        },
        enabled: enabled && wizardInProgress && canGoBack(),
      },
      {
        key: 'Escape',
        description: 'Close dialog or skip step',
        action: () => {
          skipCurrentStep?.();
        },
        enabled: enabled && wizardInProgress,
      },
      {
        key: 'Alt+S',
        description: 'Skip onboarding wizard',
        action: () => {
          onSkip?.();
        },
        enabled: enabled && wizardInProgress,
        modifiers: { alt: true },
      },
      {
        key: 'Alt+H',
        description: 'Open help panel',
        action: () => {
          onHelp?.();
        },
        enabled: enabled && wizardInProgress,
        modifiers: { alt: true },
      },
      {
        key: '?',
        description: 'Show keyboard shortcuts',
        action: () => {
          // This will be handled by the shortcuts dialog
          document.dispatchEvent(new CustomEvent('gibson:show-shortcuts'));
        },
        enabled: enabled && wizardInProgress,
      },
      // Add custom handlers
      ...Object.entries(customHandlers).map(([key, action]) => ({
        key,
        description: `Custom action: ${key}`,
        action,
        enabled: enabled && wizardInProgress,
      })),
    ],
    [
      enabled,
      wizardInProgress,
      canAdvance,
      canGoBack,
      nextStep,
      previousStep,
      skipCurrentStep,
      onAdvance,
      onBack,
      onSkip,
      onHelp,
      customHandlers,
    ]
  );

  // Parse key combination
  const parseKeyCombo = React.useCallback(
    (event: KeyboardEvent): string => {
      const parts: string[] = [];
      if (event.altKey) parts.push('Alt');
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.metaKey) parts.push('Meta');
      if (event.shiftKey) parts.push('Shift');
      parts.push(event.key);
      return parts.join('+');
    },
    []
  );

  // Check if key matches shortcut
  const matchesShortcut = React.useCallback(
    (event: KeyboardEvent, shortcut: KeyboardShortcut): boolean => {
      const modifiers = shortcut.modifiers || {};

      // Check modifier keys
      if (modifiers.alt && !event.altKey) return false;
      if (modifiers.ctrl && !event.ctrlKey) return false;
      if (modifiers.meta && !event.metaKey) return false;
      if (modifiers.shift && !event.shiftKey) return false;

      // Check main key
      const shortcutKey = shortcut.key.split('+').pop()?.toLowerCase();
      const eventKey = event.key.toLowerCase();

      return shortcutKey === eventKey;
    },
    []
  );

  // Keyboard event handler
  const handleKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = event.target as HTMLElement;
      const isInputElement =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Allow Enter and Escape even in inputs for wizard navigation
      const isNavigationKey =
        event.key === 'Enter' || event.key === 'Escape';

      if (isInputElement && !isNavigationKey) {
        return;
      }

      // Find matching shortcut
      for (const shortcut of shortcuts) {
        if (shortcut.enabled && matchesShortcut(event, shortcut)) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts, matchesShortcut]
  );

  // Register event listener
  React.useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  // Manual trigger function
  const triggerShortcut = React.useCallback(
    (key: string) => {
      const shortcut = shortcuts.find(
        (s) => s.key.toLowerCase() === key.toLowerCase()
      );
      if (shortcut?.enabled) {
        shortcut.action();
      }
    },
    [shortcuts]
  );

  // Format shortcuts for display
  const formattedShortcuts = React.useMemo(() => {
    return shortcuts
      .filter((s) => s.enabled)
      .map((s) => ({
        key: formatKeyForDisplay(s.key),
        label: s.key,
        description: s.description,
      }));
  }, [shortcuts]);

  return {
    shortcuts,
    isActive: enabled && wizardInProgress,
    triggerShortcut,
    formattedShortcuts,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format key combination for display
 */
function formatKeyForDisplay(key: string): string {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  return key
    .replace('Alt+', isMac ? '\u2325 ' : 'Alt+')
    .replace('Ctrl+', isMac ? '\u2303 ' : 'Ctrl+')
    .replace('Meta+', isMac ? '\u2318 ' : 'Win+')
    .replace('Shift+', isMac ? '\u21E7 ' : 'Shift+')
    .replace('Enter', '\u23CE')
    .replace('Escape', 'Esc')
    .replace('ArrowRight', '\u2192')
    .replace('ArrowLeft', '\u2190')
    .replace('ArrowUp', '\u2191')
    .replace('ArrowDown', '\u2193')
    .replace('Backspace', '\u232B');
}

// ============================================================================
// Keyboard Shortcuts Display Component Hook
// ============================================================================

/**
 * useKeyboardShortcutsDialog Hook
 *
 * Manages the keyboard shortcuts help dialog.
 */
export function useKeyboardShortcutsDialog() {
  const [isOpen, setIsOpen] = React.useState(false);

  // Listen for show shortcuts event
  React.useEffect(() => {
    const handleShowShortcuts = () => {
      setIsOpen(true);
    };

    document.addEventListener('gibson:show-shortcuts', handleShowShortcuts);
    return () => {
      document.removeEventListener('gibson:show-shortcuts', handleShowShortcuts);
    };
  }, []);

  const open = React.useCallback(() => setIsOpen(true), []);
  const close = React.useCallback(() => setIsOpen(false), []);
  const toggle = React.useCallback(() => setIsOpen((prev) => !prev), []);

  return {
    isOpen,
    open,
    close,
    toggle,
  };
}

// ============================================================================
// Focus Management Hook
// ============================================================================

/**
 * useFocusTrap Hook
 *
 * Traps focus within a container for accessibility.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        // Shift+Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Focus first element on mount
    firstElement?.focus();

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef]);
}

// ============================================================================
// Step Focus Management Hook
// ============================================================================

/**
 * useStepFocus Hook
 *
 * Manages focus when navigating between wizard steps.
 */
export function useStepFocus(stepRef: React.RefObject<HTMLElement>) {
  const { currentStepId: currentStep } = useOnboardingStore();

  // Focus step container when step changes
  React.useEffect(() => {
    const step = stepRef.current;
    if (!step) return;

    // Find first focusable element in step
    const focusable = step.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    // Focus with a small delay to allow for animations
    const timeoutId = setTimeout(() => {
      if (focusable) {
        focusable.focus();
      } else {
        // If no focusable element, focus the step container itself
        step.setAttribute('tabindex', '-1');
        step.focus();
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [currentStep, stepRef]);
}

// ============================================================================
// Export
// ============================================================================

export default useWizardKeyboardNavigation;
