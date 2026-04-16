import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Help Topic Types (minimal types needed for store)
// ============================================================================

/**
 * Help topic category.
 */
export type HelpCategory =
  | 'getting-started'
  | 'missions'
  | 'agents'
  | 'findings'
  | 'graph'
  | 'tools'
  | 'plugins'
  | 'settings'
  | 'general';

/**
 * Minimal help topic reference for bookmarks and history.
 */
export interface HelpTopicReference {
  /** Topic ID */
  id: string;
  /** Topic title */
  title: string;
  /** Topic category */
  category: HelpCategory;
  /** When this topic was visited/bookmarked */
  timestamp: string;
}

// ============================================================================
// Store State Interface
// ============================================================================

/**
 * Help panel state interface.
 *
 * This store manages:
 * - Panel open/close state
 * - Pinned state (panel stays open while navigating)
 * - Current topic navigation
 * - Search query and results
 * - Topic history and bookmarks
 * - User preferences
 */
export interface HelpState {
  // ========================================
  // Panel State
  // ========================================

  /** Whether the help panel is open */
  isOpen: boolean;
  /** Whether the panel is pinned (stays open during navigation) */
  isPinned: boolean;
  /** Panel width in pixels */
  panelWidth: number;
  /** Whether panel is in compact mode */
  isCompact: boolean;

  // ========================================
  // Navigation
  // ========================================

  /** Currently displayed topic ID */
  currentTopicId: string | null;
  /** Navigation history (topic IDs) */
  navigationHistory: string[];
  /** Current position in navigation history */
  historyIndex: number;
  /** Context from which help was opened (page/component) */
  openedFromContext: string | null;

  // ========================================
  // Search
  // ========================================

  /** Current search query */
  searchQuery: string;
  /** Whether search is focused */
  isSearchFocused: boolean;
  /** Recent search queries */
  recentSearches: string[];

  // ========================================
  // History & Bookmarks
  // ========================================

  /** Recently visited topics */
  recentTopics: HelpTopicReference[];
  /** Bookmarked topics */
  bookmarkedTopics: HelpTopicReference[];

  // ========================================
  // Feedback
  // ========================================

  /** Topics marked as helpful */
  helpfulTopics: string[];
  /** Topics marked as not helpful */
  notHelpfulTopics: string[];

  // ========================================
  // Actions
  // ========================================

  // Panel actions
  openHelp: (topicId?: string, context?: string) => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  togglePin: () => void;
  setPin: (pinned: boolean) => void;
  setPanelWidth: (width: number) => void;
  setCompact: (compact: boolean) => void;

  // Navigation actions
  setTopic: (topicId: string) => void;
  goBack: () => void;
  goForward: () => void;
  clearHistory: () => void;

  // Search actions
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  setSearchFocused: (focused: boolean) => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;

  // Bookmark actions
  addBookmark: (topic: HelpTopicReference) => void;
  removeBookmark: (topicId: string) => void;
  isBookmarked: (topicId: string) => boolean;
  clearBookmarks: () => void;

  // History actions
  addToRecentTopics: (topic: HelpTopicReference) => void;
  clearRecentTopics: () => void;

  // Feedback actions
  markHelpful: (topicId: string) => void;
  markNotHelpful: (topicId: string) => void;
  clearFeedback: (topicId: string) => void;

  // Computed helpers
  canGoBack: () => boolean;
  canGoForward: () => boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum recent topics to store */
const MAX_RECENT_TOPICS = 20;

/** Maximum recent searches to store */
const MAX_RECENT_SEARCHES = 10;

/** Default panel width */
const DEFAULT_PANEL_WIDTH = 400;

/** Minimum panel width */
const MIN_PANEL_WIDTH = 300;

/** Maximum panel width */
const MAX_PANEL_WIDTH = 600;

// ============================================================================
// Store Implementation
// ============================================================================

/**
 * Help panel state store with localStorage persistence.
 *
 * Persisted fields:
 * - isPinned
 * - panelWidth
 * - isCompact
 * - recentTopics
 * - bookmarkedTopics
 * - recentSearches
 * - helpfulTopics
 * - notHelpfulTopics
 *
 * Non-persisted fields (reset on reload):
 * - isOpen
 * - currentTopicId
 * - navigationHistory
 * - historyIndex
 * - openedFromContext
 * - searchQuery
 * - isSearchFocused
 */
export const useHelpStore = create<HelpState>()(
  persist(
    (set, get) => ({
      // ========================================
      // Initial State
      // ========================================

      // Panel state
      isOpen: false,
      isPinned: false,
      panelWidth: DEFAULT_PANEL_WIDTH,
      isCompact: false,

      // Navigation
      currentTopicId: null,
      navigationHistory: [],
      historyIndex: -1,
      openedFromContext: null,

      // Search
      searchQuery: '',
      isSearchFocused: false,
      recentSearches: [],

      // History & Bookmarks
      recentTopics: [],
      bookmarkedTopics: [],

      // Feedback
      helpfulTopics: [],
      notHelpfulTopics: [],

      // ========================================
      // Panel Actions
      // ========================================

      openHelp: (topicId?: string, context?: string) => {
        set({
          isOpen: true,
          openedFromContext: context ?? null,
        });

        // If topic provided, navigate to it
        if (topicId) {
          get().setTopic(topicId);
        }
      },

      closeHelp: () => {
        const { isPinned } = get();
        // If pinned, don't close
        if (isPinned) return;

        set({
          isOpen: false,
          searchQuery: '',
          isSearchFocused: false,
        });
      },

      toggleHelp: () => {
        const { isOpen } = get();
        if (isOpen) {
          get().closeHelp();
        } else {
          get().openHelp();
        }
      },

      togglePin: () => {
        set((state) => ({ isPinned: !state.isPinned }));
      },

      setPin: (pinned: boolean) => {
        set({ isPinned: pinned });
      },

      setPanelWidth: (width: number) => {
        // Clamp width to min/max bounds
        const clampedWidth = Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);
        set({ panelWidth: clampedWidth });
      },

      setCompact: (compact: boolean) => {
        set({ isCompact: compact });
      },

      // ========================================
      // Navigation Actions
      // ========================================

      setTopic: (topicId: string) => {
        const { currentTopicId, navigationHistory, historyIndex } = get();

        // Don't navigate to same topic
        if (currentTopicId === topicId) return;

        // Trim forward history if we're not at the end
        const newHistory = navigationHistory.slice(0, historyIndex + 1);

        // Add new topic to history
        newHistory.push(topicId);

        set({
          currentTopicId: topicId,
          navigationHistory: newHistory,
          historyIndex: newHistory.length - 1,
          searchQuery: '', // Clear search when navigating
        });
      },

      goBack: () => {
        const { navigationHistory, historyIndex } = get();

        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          set({
            historyIndex: newIndex,
            currentTopicId: navigationHistory[newIndex],
          });
        }
      },

      goForward: () => {
        const { navigationHistory, historyIndex } = get();

        if (historyIndex < navigationHistory.length - 1) {
          const newIndex = historyIndex + 1;
          set({
            historyIndex: newIndex,
            currentTopicId: navigationHistory[newIndex],
          });
        }
      },

      clearHistory: () => {
        set({
          navigationHistory: [],
          historyIndex: -1,
        });
      },

      // ========================================
      // Search Actions
      // ========================================

      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },

      clearSearch: () => {
        set({ searchQuery: '', isSearchFocused: false });
      },

      setSearchFocused: (focused: boolean) => {
        set({ isSearchFocused: focused });
      },

      addRecentSearch: (query: string) => {
        if (!query.trim()) return;

        set((state) => {
          // Remove duplicate if exists
          const filtered = state.recentSearches.filter(
            (s) => s.toLowerCase() !== query.toLowerCase()
          );

          // Add to front and limit size
          return {
            recentSearches: [query, ...filtered].slice(0, MAX_RECENT_SEARCHES),
          };
        });
      },

      clearRecentSearches: () => {
        set({ recentSearches: [] });
      },

      // ========================================
      // Bookmark Actions
      // ========================================

      addBookmark: (topic: HelpTopicReference) => {
        set((state) => {
          // Check if already bookmarked
          if (state.bookmarkedTopics.some((t) => t.id === topic.id)) {
            return state;
          }

          return {
            bookmarkedTopics: [
              { ...topic, timestamp: new Date().toISOString() },
              ...state.bookmarkedTopics,
            ],
          };
        });
      },

      removeBookmark: (topicId: string) => {
        set((state) => ({
          bookmarkedTopics: state.bookmarkedTopics.filter((t) => t.id !== topicId),
        }));
      },

      isBookmarked: (topicId: string) => {
        return get().bookmarkedTopics.some((t) => t.id === topicId);
      },

      clearBookmarks: () => {
        set({ bookmarkedTopics: [] });
      },

      // ========================================
      // History Actions
      // ========================================

      addToRecentTopics: (topic: HelpTopicReference) => {
        set((state) => {
          // Remove duplicate if exists
          const filtered = state.recentTopics.filter((t) => t.id !== topic.id);

          // Add to front with updated timestamp and limit size
          return {
            recentTopics: [
              { ...topic, timestamp: new Date().toISOString() },
              ...filtered,
            ].slice(0, MAX_RECENT_TOPICS),
          };
        });
      },

      clearRecentTopics: () => {
        set({ recentTopics: [] });
      },

      // ========================================
      // Feedback Actions
      // ========================================

      markHelpful: (topicId: string) => {
        set((state) => ({
          helpfulTopics: state.helpfulTopics.includes(topicId)
            ? state.helpfulTopics
            : [...state.helpfulTopics, topicId],
          // Remove from not helpful if present
          notHelpfulTopics: state.notHelpfulTopics.filter((id) => id !== topicId),
        }));
      },

      markNotHelpful: (topicId: string) => {
        set((state) => ({
          notHelpfulTopics: state.notHelpfulTopics.includes(topicId)
            ? state.notHelpfulTopics
            : [...state.notHelpfulTopics, topicId],
          // Remove from helpful if present
          helpfulTopics: state.helpfulTopics.filter((id) => id !== topicId),
        }));
      },

      clearFeedback: (topicId: string) => {
        set((state) => ({
          helpfulTopics: state.helpfulTopics.filter((id) => id !== topicId),
          notHelpfulTopics: state.notHelpfulTopics.filter((id) => id !== topicId),
        }));
      },

      // ========================================
      // Computed Helpers
      // ========================================

      canGoBack: () => {
        const { historyIndex } = get();
        return historyIndex > 0;
      },

      canGoForward: () => {
        const { navigationHistory, historyIndex } = get();
        return historyIndex < navigationHistory.length - 1;
      },
    }),
    {
      name: 'gibson-help-panel',
      // Persist user preferences and history
      partialize: (state) => ({
        isPinned: state.isPinned,
        panelWidth: state.panelWidth,
        isCompact: state.isCompact,
        recentTopics: state.recentTopics,
        bookmarkedTopics: state.bookmarkedTopics,
        recentSearches: state.recentSearches,
        helpfulTopics: state.helpfulTopics,
        notHelpfulTopics: state.notHelpfulTopics,
      }),
    }
  )
);

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Hook for help panel open/close state.
 */
export const useHelpPanelState = () => {
  const isOpen = useHelpStore((state) => state.isOpen);
  const isPinned = useHelpStore((state) => state.isPinned);
  const panelWidth = useHelpStore((state) => state.panelWidth);
  const isCompact = useHelpStore((state) => state.isCompact);

  const openHelp = useHelpStore((state) => state.openHelp);
  const closeHelp = useHelpStore((state) => state.closeHelp);
  const toggleHelp = useHelpStore((state) => state.toggleHelp);
  const togglePin = useHelpStore((state) => state.togglePin);
  const setPin = useHelpStore((state) => state.setPin);
  const setPanelWidth = useHelpStore((state) => state.setPanelWidth);
  const setCompact = useHelpStore((state) => state.setCompact);

  return {
    isOpen,
    isPinned,
    panelWidth,
    isCompact,
    openHelp,
    closeHelp,
    toggleHelp,
    togglePin,
    setPin,
    setPanelWidth,
    setCompact,
  };
};

/**
 * Hook for help topic navigation.
 */
export const useHelpNavigation = () => {
  const currentTopicId = useHelpStore((state) => state.currentTopicId);
  const navigationHistory = useHelpStore((state) => state.navigationHistory);
  const historyIndex = useHelpStore((state) => state.historyIndex);
  const openedFromContext = useHelpStore((state) => state.openedFromContext);

  const setTopic = useHelpStore((state) => state.setTopic);
  const goBack = useHelpStore((state) => state.goBack);
  const goForward = useHelpStore((state) => state.goForward);
  const clearHistory = useHelpStore((state) => state.clearHistory);
  const canGoBack = useHelpStore((state) => state.canGoBack);
  const canGoForward = useHelpStore((state) => state.canGoForward);

  return {
    currentTopicId,
    navigationHistory,
    historyIndex,
    openedFromContext,
    setTopic,
    goBack,
    goForward,
    clearHistory,
    canGoBack,
    canGoForward,
  };
};

/**
 * Hook for help search functionality.
 */
export const useHelpSearch = () => {
  const searchQuery = useHelpStore((state) => state.searchQuery);
  const isSearchFocused = useHelpStore((state) => state.isSearchFocused);
  const recentSearches = useHelpStore((state) => state.recentSearches);

  const setSearchQuery = useHelpStore((state) => state.setSearchQuery);
  const clearSearch = useHelpStore((state) => state.clearSearch);
  const setSearchFocused = useHelpStore((state) => state.setSearchFocused);
  const addRecentSearch = useHelpStore((state) => state.addRecentSearch);
  const clearRecentSearches = useHelpStore((state) => state.clearRecentSearches);

  return {
    searchQuery,
    isSearchFocused,
    recentSearches,
    setSearchQuery,
    clearSearch,
    setSearchFocused,
    addRecentSearch,
    clearRecentSearches,
  };
};

/**
 * Hook for help bookmarks.
 */
export const useHelpBookmarks = () => {
  const bookmarkedTopics = useHelpStore((state) => state.bookmarkedTopics);

  const addBookmark = useHelpStore((state) => state.addBookmark);
  const removeBookmark = useHelpStore((state) => state.removeBookmark);
  const isBookmarked = useHelpStore((state) => state.isBookmarked);
  const clearBookmarks = useHelpStore((state) => state.clearBookmarks);

  return {
    bookmarkedTopics,
    addBookmark,
    removeBookmark,
    isBookmarked,
    clearBookmarks,
  };
};

/**
 * Hook for recently visited help topics.
 */
export const useRecentHelpTopics = () => {
  const recentTopics = useHelpStore((state) => state.recentTopics);

  const addToRecentTopics = useHelpStore((state) => state.addToRecentTopics);
  const clearRecentTopics = useHelpStore((state) => state.clearRecentTopics);

  return {
    recentTopics,
    addToRecentTopics,
    clearRecentTopics,
  };
};

/**
 * Hook for help topic feedback.
 */
export const useHelpFeedback = () => {
  const helpfulTopics = useHelpStore((state) => state.helpfulTopics);
  const notHelpfulTopics = useHelpStore((state) => state.notHelpfulTopics);

  const markHelpful = useHelpStore((state) => state.markHelpful);
  const markNotHelpful = useHelpStore((state) => state.markNotHelpful);
  const clearFeedback = useHelpStore((state) => state.clearFeedback);

  const getFeedback = (topicId: string): 'helpful' | 'not-helpful' | null => {
    if (helpfulTopics.includes(topicId)) return 'helpful';
    if (notHelpfulTopics.includes(topicId)) return 'not-helpful';
    return null;
  };

  return {
    helpfulTopics,
    notHelpfulTopics,
    markHelpful,
    markNotHelpful,
    clearFeedback,
    getFeedback,
  };
};
