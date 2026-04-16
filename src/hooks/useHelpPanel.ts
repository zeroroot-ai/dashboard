'use client';

import * as React from 'react';
import { useHelpStore, useHelpPanelState, useHelpNavigation } from '@/src/stores/help-store';
import { getHelpTopic, type HelpCategory } from '@/src/lib/help/content';
import { searchHelp, getSuggestedTopics } from '@/src/lib/help/search';

/**
 * useHelpPanel Hook
 *
 * Exposes help panel actions and state with keyboard shortcut registration.
 *
 * Features:
 * - Open/close/toggle panel
 * - Navigate to specific topics
 * - Search functionality
 * - Keyboard shortcut (Cmd+K) registration
 * - Context-aware suggestions
 */

export interface UseHelpPanelOptions {
  /** Register global Cmd+K shortcut (default: true) */
  registerShortcut?: boolean;
  /** Current page context for suggestions */
  pageContext?: string;
}

export interface UseHelpPanelReturn {
  // State
  isOpen: boolean;
  isPinned: boolean;
  currentTopic: string | null;
  searchQuery: string;

  // Actions
  open: () => void;
  close: () => void;
  toggle: () => void;
  openTopic: (topicId: string) => void;
  search: (query: string) => void;
  pin: () => void;
  unpin: () => void;
  togglePin: () => void;

  // Navigation
  goBack: () => void;
  canGoBack: () => boolean;
  clearHistory: () => void;

  // Bookmarks
  bookmarks: string[];
  isBookmarked: (topicId: string) => boolean;
  addBookmark: (topicId: string) => void;
  removeBookmark: (topicId: string) => void;
  toggleBookmark: (topicId: string) => void;

  // Suggestions
  getSuggestions: () => ReturnType<typeof getSuggestedTopics>;
}

export function useHelpPanel(
  options: UseHelpPanelOptions = {}
): UseHelpPanelReturn {
  const { registerShortcut = true, pageContext } = options;

  // Get store state and actions
  const { isOpen, isPinned, openHelp, closeHelp, togglePin } = useHelpPanelState();
  const { currentTopicId: currentTopic, setTopic, goBack, canGoBack, clearHistory } = useHelpNavigation();
  const { searchQuery, setSearchQuery } = useHelpStore((state) => ({
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
  }));
  const addToHistory = useHelpStore((state) => state.addToRecentTopics);
  const { addBookmarkRef, removeBookmark, bookmarkedTopics } = useHelpStore((state) => ({
    addBookmarkRef: state.addBookmark,
    removeBookmark: state.removeBookmark,
    bookmarkedTopics: state.bookmarkedTopics,
  }));
  const bookmarkedIds = bookmarkedTopics.map((t) => t.id);

  // Register Cmd+K keyboard shortcut
  React.useEffect(() => {
    if (!registerShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          closeHelp();
        } else {
          openHelp();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [registerShortcut, isOpen, openHelp, closeHelp]);

  // Action: Open panel
  const open = React.useCallback(() => {
    openHelp();
  }, [openHelp]);

  // Action: Close panel
  const close = React.useCallback(() => {
    closeHelp();
  }, [closeHelp]);

  // Action: Toggle panel
  const toggle = React.useCallback(() => {
    if (isOpen) {
      closeHelp();
    } else {
      openHelp();
    }
  }, [isOpen, openHelp, closeHelp]);

  // Action: Open specific topic
  const openTopic = React.useCallback(
    (topicId: string) => {
      const topic = getHelpTopic(topicId);
      if (topic) {
        setTopic(topicId);
        addToHistory({
          id: topicId,
          title: topicId,
          category: 'general',
          timestamp: new Date().toISOString(),
        });
        if (!isOpen) {
          openHelp();
        }
      }
    },
    [setTopic, addToHistory, isOpen, openHelp]
  );

  // Action: Search
  const search = React.useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!isOpen && query.trim()) {
        openHelp();
      }
    },
    [setSearchQuery, isOpen, openHelp]
  );

  // Action: Pin panel
  const pin = React.useCallback(() => {
    if (!isPinned) {
      togglePin();
    }
  }, [isPinned, togglePin]);

  // Action: Unpin panel
  const unpin = React.useCallback(() => {
    if (isPinned) {
      togglePin();
    }
  }, [isPinned, togglePin]);

  const addBookmark = React.useCallback(
    (topicId: string) => {
      addBookmarkRef({
        id: topicId,
        title: topicId,
        category: 'general',
        timestamp: new Date().toISOString(),
      });
    },
    [addBookmarkRef]
  );

  // Bookmark helpers
  const isBookmarked = React.useCallback(
    (topicId: string) => bookmarkedIds.includes(topicId),
    [bookmarkedIds]
  );

  const toggleBookmark = React.useCallback(
    (topicId: string) => {
      if (bookmarkedIds.includes(topicId)) {
        removeBookmark(topicId);
      } else {
        addBookmark(topicId);
      }
    },
    [bookmarkedIds, addBookmark, removeBookmark]
  );

  // Get context-aware suggestions
  const getSuggestions = React.useCallback(() => {
    const category = pageContext
      ? inferCategoryFromPage(pageContext)
      : undefined;

    return getSuggestedTopics({
      page: pageContext,
      category: category ?? undefined,
      recentTopics: useHelpStore.getState().recentTopics.map((t) => t.id),
    });
  }, [pageContext]);

  return {
    // State
    isOpen,
    isPinned,
    currentTopic,
    searchQuery,

    // Actions
    open,
    close,
    toggle,
    openTopic,
    search,
    pin,
    unpin,
    togglePin,

    // Navigation
    goBack,
    canGoBack,
    clearHistory,

    // Bookmarks
    bookmarks: bookmarkedIds,
    isBookmarked,
    addBookmark,
    removeBookmark,
    toggleBookmark,

    // Suggestions
    getSuggestions,
  };
}

/**
 * useHelpTopic Hook
 *
 * Get a specific help topic by ID.
 */
export function useHelpTopic(topicId: string | null) {
  return React.useMemo(() => {
    if (!topicId) return null;
    return getHelpTopic(topicId);
  }, [topicId]);
}

/**
 * useHelpSearch Hook
 *
 * Search help topics with options.
 */
export function useHelpSearch(
  query: string,
  options?: {
    limit?: number;
    category?: HelpCategory;
    contextCategory?: HelpCategory;
  }
) {
  return React.useMemo(() => {
    if (!query.trim()) return [];
    return searchHelp(query, options);
  }, [query, options?.limit, options?.category, options?.contextCategory]);
}

/**
 * useContextualHelp Hook
 *
 * Get help suggestions based on current page context.
 */
export function useContextualHelp(pageContext?: string) {
  const [suggestions, setSuggestions] = React.useState<
    ReturnType<typeof getSuggestedTopics>
  >([]);

  React.useEffect(() => {
    const category = pageContext
      ? inferCategoryFromPage(pageContext)
      : undefined;

    const topics = getSuggestedTopics({
      page: pageContext,
      category: category ?? undefined,
    });

    setSuggestions(topics);
  }, [pageContext]);

  return suggestions;
}

// Helper to infer category from page path
function inferCategoryFromPage(page: string): HelpCategory | null {
  if (page.includes('mission')) return 'missions';
  if (page.includes('agent')) return 'agents';
  if (page.includes('finding')) return 'findings';
  if (page.includes('graph')) return 'graph';
  if (page.includes('setting')) return 'settings';
  if (page.includes('tool')) return 'tools';
  return null;
}

export default useHelpPanel;
