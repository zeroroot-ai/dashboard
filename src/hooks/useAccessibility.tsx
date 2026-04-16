/**
 * Accessibility Hooks
 *
 * React hooks for WCAG 2.1 AA compliant accessibility features.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  announce,
  announceLoading,
  announceLoaded,
  announceError,
  announceSuccess,
  createFocusTrap,
  handleArrowNavigation,
  prefersReducedMotion,
  getAnimationDuration,
  initializeLiveRegion,
  type KeyboardNavigationOptions,
} from '@/src/lib/accessibility';

// ============================================================================
// useAnnounce
// ============================================================================

/**
 * Hook for screen reader announcements
 */
export function useAnnounce(): {
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
  announceLoading: (resourceName: string) => void;
  announceLoaded: (resourceName: string, count?: number) => void;
  announceError: (message: string) => void;
  announceSuccess: (message: string) => void;
} {
  // Initialize live region on mount
  useEffect(() => {
    initializeLiveRegion();
  }, []);

  return {
    announce,
    announceLoading,
    announceLoaded,
    announceError,
    announceSuccess,
  };
}

// ============================================================================
// useFocusTrap
// ============================================================================

/**
 * Hook for trapping focus within a container
 */
export function useFocusTrap<T extends HTMLElement>(
  options: {
    isActive?: boolean;
    onEscape?: () => void;
    returnFocus?: boolean;
  } = {}
): React.RefObject<T | null> {
  const { isActive = true, onEscape, returnFocus = true } = options;
  const containerRef = useRef<T>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) {
      // Clean up if deactivating
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    // Create focus trap
    cleanupRef.current = createFocusTrap({
      container: containerRef.current,
      returnFocus,
      onEscape,
    });

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [isActive, onEscape, returnFocus]);

  return containerRef;
}

// ============================================================================
// useKeyboardNavigation
// ============================================================================

/**
 * Hook for keyboard navigation through a list of items
 */
export function useKeyboardNavigation(options: {
  itemCount: number;
  wrap?: boolean;
  orientation?: 'horizontal' | 'vertical' | 'both';
  onSelect?: (index: number) => void;
}): {
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  getItemProps: (index: number) => {
    tabIndex: number;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onFocus: () => void;
  };
} {
  const { itemCount, wrap = true, orientation = 'vertical', onSelect } = options;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // Update refs array size
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, itemCount);
  }, [itemCount]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[];

    const newIndex = handleArrowNavigation(event.nativeEvent, {
      items,
      currentIndex: focusedIndex,
      wrap,
      orientation,
    });

    if (newIndex !== focusedIndex) {
      setFocusedIndex(newIndex);
    }

    // Handle selection on Enter/Space
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(focusedIndex);
    }
  }, [focusedIndex, wrap, orientation, onSelect]);

  const getItemProps = useCallback((index: number) => ({
    tabIndex: index === focusedIndex ? 0 : -1,
    onKeyDown: handleKeyDown,
    onFocus: () => setFocusedIndex(index),
    ref: (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
  }), [focusedIndex, handleKeyDown]);

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getItemProps,
  };
}

// ============================================================================
// useReducedMotion
// ============================================================================

/**
 * Hook for respecting reduced motion preference
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    // Check initial value
    setPrefersReduced(prefersReducedMotion());

    // Listen for changes
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReduced(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return prefersReduced;
}

/**
 * Hook that returns animation duration based on reduced motion preference
 */
export function useAnimationDuration(normalDuration: number): number {
  const prefersReduced = useReducedMotion();
  return prefersReduced ? 0 : normalDuration;
}

// ============================================================================
// useLiveRegion
// ============================================================================

/**
 * Hook for managing a local live region
 */
export function useLiveRegion(): {
  message: string;
  setMessage: (message: string, priority?: 'polite' | 'assertive') => void;
  LiveRegion: React.FC;
} {
  const [message, setMessageState] = useState('');
  const [priority, setPriority] = useState<'polite' | 'assertive'>('polite');

  const setMessage = useCallback((newMessage: string, newPriority: 'polite' | 'assertive' = 'polite') => {
    setMessageState('');
    setPriority(newPriority);
    // Use setTimeout to ensure the message is announced
    setTimeout(() => {
      setMessageState(newMessage);
    }, 100);
  }, []);

  const LiveRegion: React.FC = useCallback(() => (
    <div
      aria-live={priority}
      aria-atomic="true"
      role="status"
      className="sr-only"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {message}
    </div>
  ), [message, priority]);

  return { message, setMessage, LiveRegion };
}

// ============================================================================
// useRoving Tabindex
// ============================================================================

/**
 * Hook for roving tabindex pattern (widget with single tab stop)
 */
export function useRovingTabindex<T extends HTMLElement>(
  options: {
    items: T[];
    initialIndex?: number;
    loop?: boolean;
  }
): {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  getRovingProps: (index: number) => {
    tabIndex: number;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onClick: () => void;
    'data-active': boolean;
  };
} {
  const { items, initialIndex = 0, loop = true } = options;
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, index: number) => {
    let newIndex = index;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        newIndex = loop
          ? (index + 1) % items.length
          : Math.min(index + 1, items.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        newIndex = loop
          ? (index - 1 + items.length) % items.length
          : Math.max(index - 1, 0);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        newIndex = items.length - 1;
        break;
      default:
        return;
    }

    setActiveIndex(newIndex);
    items[newIndex]?.focus();
  }, [items, loop]);

  const getRovingProps = useCallback((index: number) => ({
    tabIndex: index === activeIndex ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent) => handleKeyDown(event, index),
    onClick: () => {
      setActiveIndex(index);
      items[index]?.focus();
    },
    'data-active': index === activeIndex,
  }), [activeIndex, handleKeyDown, items]);

  return {
    activeIndex,
    setActiveIndex,
    getRovingProps,
  };
}

// ============================================================================
// useSkipLink
// ============================================================================

/**
 * Hook for managing skip links
 */
export function useSkipLink(): {
  skipToMain: () => void;
  SkipLink: React.FC<{ targetId: string; label: string }>;
} {
  const skipToMain = useCallback(() => {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.tabIndex = -1;
      mainContent.focus();
      mainContent.scrollIntoView();
    }
  }, []);

  const SkipLink: React.FC<{ targetId: string; label: string }> = useCallback(
    ({ targetId, label }) => {
      const handleClick = (event: React.MouseEvent) => {
        event.preventDefault();
        const target = document.getElementById(targetId);
        if (target) {
          target.tabIndex = -1;
          target.focus();
          target.scrollIntoView();
        }
      };

      return (
        <a
          href={`#${targetId}`}
          onClick={handleClick}
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-white focus:text-blue-700 focus:underline"
        >
          {label}
        </a>
      );
    },
    []
  );

  return { skipToMain, SkipLink };
}

// ============================================================================
// useHighContrastMode
// ============================================================================

/**
 * Hook for detecting high contrast mode
 */
export function useHighContrastMode(): boolean {
  const [isHighContrast, setIsHighContrast] = useState(false);

  useEffect(() => {
    // Check for forced-colors (Windows High Contrast)
    const mediaQuery = window.matchMedia('(forced-colors: active)');

    setIsHighContrast(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsHighContrast(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return isHighContrast;
}

// ============================================================================
// useTableNavigation
// ============================================================================

/**
 * Hook for accessible table navigation
 */
export function useTableNavigation(options: {
  rowCount: number;
  colCount: number;
  onCellSelect?: (row: number, col: number) => void;
}): {
  focusedCell: { row: number; col: number };
  setFocusedCell: (row: number, col: number) => void;
  handleTableKeyDown: (event: React.KeyboardEvent) => void;
  getCellProps: (row: number, col: number) => {
    tabIndex: number;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onFocus: () => void;
    'aria-colindex': number;
    'aria-rowindex': number;
  };
} {
  const { rowCount, colCount, onCellSelect } = options;
  const [focusedCell, setFocusedCellState] = useState({ row: 0, col: 0 });

  const setFocusedCell = useCallback((row: number, col: number) => {
    setFocusedCellState({ row, col });
  }, []);

  const handleTableKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { row, col } = focusedCell;
    let newRow = row;
    let newCol = col;

    switch (event.key) {
      case 'ArrowRight':
        newCol = Math.min(col + 1, colCount - 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(col - 1, 0);
        break;
      case 'ArrowDown':
        newRow = Math.min(row + 1, rowCount - 1);
        break;
      case 'ArrowUp':
        newRow = Math.max(row - 1, 0);
        break;
      case 'Home':
        if (event.ctrlKey) {
          newRow = 0;
          newCol = 0;
        } else {
          newCol = 0;
        }
        break;
      case 'End':
        if (event.ctrlKey) {
          newRow = rowCount - 1;
          newCol = colCount - 1;
        } else {
          newCol = colCount - 1;
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onCellSelect?.(row, col);
        return;
      default:
        return;
    }

    if (newRow !== row || newCol !== col) {
      event.preventDefault();
      setFocusedCell(newRow, newCol);
    }
  }, [focusedCell, rowCount, colCount, onCellSelect, setFocusedCell]);

  const getCellProps = useCallback((row: number, col: number) => ({
    tabIndex: row === focusedCell.row && col === focusedCell.col ? 0 : -1,
    onKeyDown: handleTableKeyDown,
    onFocus: () => setFocusedCell(row, col),
    'aria-colindex': col + 1,
    'aria-rowindex': row + 1,
  }), [focusedCell, handleTableKeyDown, setFocusedCell]);

  return {
    focusedCell,
    setFocusedCell,
    handleTableKeyDown,
    getCellProps,
  };
}

export default useAnnounce;
