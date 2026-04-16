/**
 * Onboarding Accessibility Utilities
 *
 * Provides WCAG 2.1 AA compliant accessibility utilities for the onboarding wizard.
 * Includes ARIA attributes, screen reader support, and focus management.
 */

import * as React from 'react';
import { WizardStepId, WIZARD_STEPS } from '@/src/types/onboarding';

// ============================================================================
// ARIA Attribute Generators
// ============================================================================

/**
 * Generate ARIA attributes for wizard progress indicator
 */
export function getProgressIndicatorA11y(
  currentStep: number,
  totalSteps: number,
  stepLabel: string
): React.AriaAttributes & { role: string } {
  const progress = Math.round((currentStep / totalSteps) * 100);

  return {
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': progress,
    'aria-valuetext': `Step ${currentStep + 1} of ${totalSteps}: ${stepLabel}. ${progress}% complete.`,
    'aria-label': 'Onboarding progress',
  };
}

/**
 * Generate ARIA attributes for step list
 */
export function getStepListA11y(): React.AriaAttributes & { role: string } {
  return {
    role: 'list',
    'aria-label': 'Onboarding steps',
  };
}

/**
 * Generate ARIA attributes for individual step item
 */
export function getStepItemA11y(
  stepIndex: number,
  stepId: WizardStepId,
  stepLabel: string,
  currentStep: number,
  isCompleted: boolean
): React.AriaAttributes & { role: string } {
  const isCurrent = stepIndex === currentStep;
  let status: string;

  if (isCompleted) {
    status = 'completed';
  } else if (isCurrent) {
    status = 'current';
  } else {
    status = 'upcoming';
  }

  return {
    role: 'listitem',
    'aria-current': isCurrent ? 'step' : undefined,
    'aria-label': `${stepLabel}, step ${stepIndex + 1}, ${status}`,
  };
}

/**
 * Generate ARIA attributes for wizard step container
 */
export function getStepContainerA11y(
  stepId: WizardStepId,
  stepIndex: number,
  totalSteps: number
): React.AriaAttributes & { role: string } {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  const stepLabel = step?.title || 'Step';

  return {
    role: 'region',
    'aria-label': `${stepLabel} - Step ${stepIndex + 1} of ${totalSteps}`,
    'aria-live': 'polite',
    'aria-atomic': true,
  };
}

/**
 * Generate ARIA attributes for navigation buttons
 */
export function getNavigationButtonA11y(
  type: 'next' | 'previous' | 'skip' | 'complete',
  isDisabled: boolean
): React.AriaAttributes {
  const labels = {
    next: 'Go to next step',
    previous: 'Go to previous step',
    skip: 'Skip onboarding wizard',
    complete: 'Complete onboarding',
  };

  return {
    'aria-label': labels[type],
    'aria-disabled': isDisabled,
  };
}

/**
 * Generate ARIA attributes for form fields
 */
export function getFormFieldA11y(
  fieldId: string,
  label: string,
  isRequired: boolean,
  errorMessage?: string,
  helpText?: string
): React.AriaAttributes {
  const attrs: React.AriaAttributes = {
    'aria-required': isRequired,
    'aria-invalid': !!errorMessage,
  };

  if (errorMessage) {
    attrs['aria-errormessage'] = `${fieldId}-error`;
    attrs['aria-describedby'] = `${fieldId}-error`;
  } else if (helpText) {
    attrs['aria-describedby'] = `${fieldId}-help`;
  }

  return attrs;
}

/**
 * Generate ARIA attributes for selection cards (provider, agent, template)
 */
export function getSelectionCardA11y(
  cardId: string,
  cardLabel: string,
  isSelected: boolean,
  groupLabel: string
): React.AriaAttributes & { role: string } {
  return {
    role: 'radio',
    'aria-checked': isSelected,
    'aria-label': cardLabel,
    'aria-describedby': `${cardId}-description`,
  };
}

/**
 * Generate ARIA attributes for selection group
 */
export function getSelectionGroupA11y(
  groupLabel: string
): React.AriaAttributes & { role: string } {
  return {
    role: 'radiogroup',
    'aria-label': groupLabel,
  };
}

// ============================================================================
// Screen Reader Announcements
// ============================================================================

/**
 * Live region for screen reader announcements
 */
let liveRegion: HTMLElement | null = null;

/**
 * Initialize live region for announcements
 */
export function initializeLiveRegion(): void {
  if (typeof document === 'undefined') return;
  if (liveRegion) return;

  liveRegion = document.createElement('div');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.className = 'sr-only';
  liveRegion.style.cssText = `
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `;
  document.body.appendChild(liveRegion);
}

/**
 * Announce message to screen readers
 */
export function announce(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  if (typeof document === 'undefined') return;

  initializeLiveRegion();

  if (!liveRegion) return;

  liveRegion.setAttribute('aria-live', priority);
  liveRegion.textContent = '';

  // Small delay to ensure the change is announced
  requestAnimationFrame(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  });
}

/**
 * Announce step change
 */
export function announceStepChange(
  stepIndex: number,
  totalSteps: number,
  stepTitle: string
): void {
  announce(
    `Step ${stepIndex + 1} of ${totalSteps}: ${stepTitle}. Use Tab to navigate through the form.`,
    'polite'
  );
}

/**
 * Announce validation error
 */
export function announceError(errorMessage: string): void {
  announce(`Error: ${errorMessage}`, 'assertive');
}

/**
 * Announce validation success
 */
export function announceSuccess(successMessage: string): void {
  announce(successMessage, 'polite');
}

/**
 * Announce wizard completion
 */
export function announceWizardComplete(): void {
  announce(
    'Congratulations! Onboarding complete. You can now use Gibson to run security missions.',
    'polite'
  );
}

// ============================================================================
// Focus Management
// ============================================================================

/**
 * Focus the first focusable element in a container
 */
export function focusFirstElement(container: HTMLElement): void {
  const focusable = container.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );

  if (focusable) {
    focusable.focus();
  }
}

/**
 * Focus the heading of a step for context
 */
export function focusStepHeading(container: HTMLElement): void {
  const heading = container.querySelector<HTMLElement>('h1, h2, h3, [role="heading"]');

  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

/**
 * Restore focus to a saved element
 */
export function restoreFocus(element: HTMLElement | null): void {
  if (element && document.body.contains(element)) {
    element.focus();
  }
}

/**
 * Save current focus for later restoration
 */
export function saveFocus(): HTMLElement | null {
  return document.activeElement as HTMLElement | null;
}

// ============================================================================
// Skip Links
// ============================================================================

/**
 * Generate skip link targets for the wizard
 */
export function getSkipLinkTargets(): Array<{
  id: string;
  label: string;
}> {
  return [
    { id: 'wizard-content', label: 'Skip to wizard content' },
    { id: 'wizard-navigation', label: 'Skip to navigation buttons' },
    { id: 'wizard-help', label: 'Skip to help' },
  ];
}

// ============================================================================
// Color Contrast
// ============================================================================

/**
 * Check if a color combination meets WCAG AA contrast requirements
 */
export function meetsContrastRequirement(
  foreground: string,
  background: string,
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background);
  const minRatio = isLargeText ? 3.0 : 4.5;
  return ratio >= minRatio;
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(color1: string, color2: string): number {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Calculate relative luminance of a color
 */
function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// ============================================================================
// Motion Preferences
// ============================================================================

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get animation duration based on motion preferences
 */
export function getAnimationDuration(defaultMs: number): number {
  return prefersReducedMotion() ? 0 : defaultMs;
}

// ============================================================================
// React Hooks
// ============================================================================

/**
 * useA11yAnnouncer Hook
 *
 * Provides announcement utilities for React components.
 */
export function useA11yAnnouncer() {
  React.useEffect(() => {
    initializeLiveRegion();
  }, []);

  return {
    announce,
    announceError,
    announceSuccess,
    announceStepChange,
    announceWizardComplete,
  };
}

/**
 * useReducedMotion Hook
 *
 * Tracks user's motion preferences.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}

/**
 * useFocusOnMount Hook
 *
 * Focuses an element when component mounts.
 */
export function useFocusOnMount(ref: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    const element = ref.current;
    if (element) {
      // Small delay to allow for rendering
      const timeoutId = setTimeout(() => {
        element.focus();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [ref]);
}

/**
 * useSkipLink Hook
 *
 * Manages skip link functionality.
 */
export function useSkipLink(targetId: string) {
  const skipToTarget = React.useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [targetId]);

  return { skipToTarget };
}

// ============================================================================
// Export
// ============================================================================

export default {
  // ARIA generators
  getProgressIndicatorA11y,
  getStepListA11y,
  getStepItemA11y,
  getStepContainerA11y,
  getNavigationButtonA11y,
  getFormFieldA11y,
  getSelectionCardA11y,
  getSelectionGroupA11y,

  // Announcements
  initializeLiveRegion,
  announce,
  announceStepChange,
  announceError,
  announceSuccess,
  announceWizardComplete,

  // Focus management
  focusFirstElement,
  focusStepHeading,
  restoreFocus,
  saveFocus,

  // Skip links
  getSkipLinkTargets,

  // Color contrast
  meetsContrastRequirement,

  // Motion preferences
  prefersReducedMotion,
  getAnimationDuration,

  // Hooks
  useA11yAnnouncer,
  useReducedMotion,
  useFocusOnMount,
  useSkipLink,
};
