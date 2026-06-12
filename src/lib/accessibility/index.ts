/**
 * Accessibility Utilities, Barrel Export
 *
 * Re-exports all utilities from onboarding-a11y and provides additional
 * generic accessibility helpers used by useAccessibility.tsx.
 */

export * from './onboarding-a11y';

// ============================================================================
// Announcement helpers not in onboarding-a11y
// ============================================================================

import { announce } from './onboarding-a11y';

/**
 * Announce a loading state to screen readers.
 */
export function announceLoading(resourceName: string): void {
  announce(`Loading ${resourceName}…`, 'polite');
}

/**
 * Announce that loading has completed to screen readers.
 */
export function announceLoaded(resourceName: string, count?: number): void {
  if (count !== undefined) {
    announce(`${resourceName} loaded. ${count} item${count !== 1 ? 's' : ''} found.`, 'polite');
  } else {
    announce(`${resourceName} loaded.`, 'polite');
  }
}

// ============================================================================
// Focus trap
// ============================================================================

export interface FocusTrapOptions {
  container: HTMLElement;
  returnFocus?: boolean;
  onEscape?: () => void;
}

const FOCUSABLE_SELECTORS =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [contenteditable], [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus within a container element. Returns a cleanup function.
 */
export function createFocusTrap(options: FocusTrapOptions): () => void {
  const { container, returnFocus = true, onEscape } = options;

  const previouslyFocused = returnFocus
    ? (document.activeElement as HTMLElement | null)
    : null;

  function getFocusable(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
      (el) => !el.closest('[aria-hidden="true"]')
    );
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onEscape?.();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusable();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  // Move focus into the container if not already there
  if (!container.contains(document.activeElement)) {
    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }

  document.addEventListener('keydown', handleKeyDown);

  return () => {
    document.removeEventListener('keydown', handleKeyDown);
    if (returnFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };
}

// ============================================================================
// Arrow-key navigation
// ============================================================================

export interface KeyboardNavigationOptions {
  items: HTMLElement[];
  currentIndex: number;
  wrap?: boolean;
  orientation?: 'horizontal' | 'vertical' | 'both';
}

/**
 * Handle arrow-key navigation within a list of items.
 * Returns the new index (same as currentIndex if no navigation occurred).
 */
export function handleArrowNavigation(
  event: KeyboardEvent,
  options: KeyboardNavigationOptions
): number {
  const { items, currentIndex, wrap = true, orientation = 'vertical' } = options;
  const count = items.length;
  if (count === 0) return currentIndex;

  const isVertical = orientation === 'vertical' || orientation === 'both';
  const isHorizontal = orientation === 'horizontal' || orientation === 'both';

  let newIndex = currentIndex;

  if (isVertical && event.key === 'ArrowDown') {
    event.preventDefault();
    newIndex = wrap ? (currentIndex + 1) % count : Math.min(currentIndex + 1, count - 1);
  } else if (isVertical && event.key === 'ArrowUp') {
    event.preventDefault();
    newIndex = wrap
      ? (currentIndex - 1 + count) % count
      : Math.max(currentIndex - 1, 0);
  } else if (isHorizontal && event.key === 'ArrowRight') {
    event.preventDefault();
    newIndex = wrap ? (currentIndex + 1) % count : Math.min(currentIndex + 1, count - 1);
  } else if (isHorizontal && event.key === 'ArrowLeft') {
    event.preventDefault();
    newIndex = wrap
      ? (currentIndex - 1 + count) % count
      : Math.max(currentIndex - 1, 0);
  } else if (event.key === 'Home') {
    event.preventDefault();
    newIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    newIndex = count - 1;
  }

  if (newIndex !== currentIndex) {
    items[newIndex]?.focus();
  }

  return newIndex;
}
