/**
 * Help Search System
 *
 * Full-text search for help content with relevance scoring.
 */

import { HELP_TOPICS, type HelpTopic, type HelpCategory } from './content';

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  topic: HelpTopic;
  score: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  field: 'title' | 'description' | 'keywords' | 'content';
  excerpt: string;
  positions: number[];
}

export interface SearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Filter by category */
  category?: HelpCategory;
  /** Prioritize by current context (page) */
  contextCategory?: HelpCategory;
  /** Enable fuzzy matching */
  fuzzy?: boolean;
}

// ============================================================================
// Search Index (built at module load)
// ============================================================================

interface IndexEntry {
  topicId: string;
  field: 'title' | 'description' | 'keywords' | 'content';
  terms: string[];
  originalText: string;
}

// Build inverted index
const searchIndex: Map<string, IndexEntry[]> = new Map();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

function buildIndex() {
  for (const topic of HELP_TOPICS) {
    // Index title
    const titleTerms = tokenize(topic.title);
    addToIndex(titleTerms, {
      topicId: topic.id,
      field: 'title',
      terms: titleTerms,
      originalText: topic.title,
    });

    // Index description
    const descTerms = tokenize(topic.description);
    addToIndex(descTerms, {
      topicId: topic.id,
      field: 'description',
      terms: descTerms,
      originalText: topic.description,
    });

    // Index keywords
    const keywordTerms = topic.keywords.flatMap((k) => tokenize(k));
    addToIndex(keywordTerms, {
      topicId: topic.id,
      field: 'keywords',
      terms: keywordTerms,
      originalText: topic.keywords.join(', '),
    });

    // Index content (first 500 chars for performance)
    const contentTerms = tokenize(topic.content.slice(0, 500));
    addToIndex(contentTerms, {
      topicId: topic.id,
      field: 'content',
      terms: contentTerms,
      originalText: topic.content.slice(0, 200),
    });
  }
}

function addToIndex(terms: string[], entry: IndexEntry) {
  for (const term of terms) {
    const existing = searchIndex.get(term) || [];
    // Avoid duplicates
    if (!existing.some((e) => e.topicId === entry.topicId && e.field === entry.field)) {
      existing.push(entry);
      searchIndex.set(term, existing);
    }
  }
}

// Build index on module load
buildIndex();

// ============================================================================
// Search Function
// ============================================================================

/**
 * Search help topics
 */
export function searchHelp(
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const {
    limit = 10,
    category,
    contextCategory,
    fuzzy = true,
  } = options;

  if (!query.trim()) {
    return [];
  }

  const queryTerms = tokenize(query);
  const resultMap = new Map<string, SearchResult>();

  for (const term of queryTerms) {
    // Exact matches
    const exactMatches = searchIndex.get(term) || [];

    // Fuzzy matches (prefix matching)
    const fuzzyMatches: IndexEntry[] = [];
    if (fuzzy && term.length >= 3) {
      for (const [indexTerm, entries] of searchIndex.entries()) {
        if (indexTerm.startsWith(term) || term.startsWith(indexTerm)) {
          fuzzyMatches.push(...entries);
        }
      }
    }

    // Process matches
    const allMatches = [...exactMatches, ...fuzzyMatches];
    for (const entry of allMatches) {
      const topic = HELP_TOPICS.find((t) => t.id === entry.topicId);
      if (!topic) continue;

      // Apply category filter
      if (category && topic.category !== category) continue;

      // Get or create result entry
      let result = resultMap.get(entry.topicId);
      if (!result) {
        result = {
          topic,
          score: 0,
          matches: [],
        };
        resultMap.set(entry.topicId, result);
      }

      // Calculate score based on field
      const fieldScores = {
        title: 10,
        keywords: 8,
        description: 5,
        content: 2,
      };

      const isExact = exactMatches.includes(entry);
      const baseScore = fieldScores[entry.field];
      const matchScore = isExact ? baseScore : baseScore * 0.5;

      result.score += matchScore;

      // Context boost
      if (contextCategory && topic.category === contextCategory) {
        result.score += 3;
      }

      // Add match info
      result.matches.push({
        field: entry.field,
        excerpt: createExcerpt(entry.originalText, term),
        positions: findPositions(entry.originalText.toLowerCase(), term),
      });
    }
  }

  // Sort by score and limit
  const results = Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Create excerpt with highlighted match
 */
function createExcerpt(text: string, term: string, contextLength = 50): string {
  const lowerText = text.toLowerCase();
  const position = lowerText.indexOf(term.toLowerCase());

  if (position === -1) {
    return text.slice(0, contextLength * 2) + '...';
  }

  const start = Math.max(0, position - contextLength);
  const end = Math.min(text.length, position + term.length + contextLength);

  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt = excerpt + '...';

  return excerpt;
}

/**
 * Find all positions of term in text
 */
function findPositions(text: string, term: string): number[] {
  const positions: number[] = [];
  let pos = 0;

  while ((pos = text.indexOf(term, pos)) !== -1) {
    positions.push(pos);
    pos += term.length;
  }

  return positions;
}

// ============================================================================
// Quick Search (autocomplete)
// ============================================================================

export interface QuickSearchResult {
  id: string;
  title: string;
  category: HelpCategory;
  description: string;
}

/**
 * Quick search for autocomplete
 */
export function quickSearch(
  query: string,
  limit = 5
): QuickSearchResult[] {
  const results = searchHelp(query, { limit, fuzzy: true });

  return results.map((r) => ({
    id: r.topic.id,
    title: r.topic.title,
    category: r.topic.category,
    description: r.topic.description,
  }));
}

// ============================================================================
// Context-aware Search
// ============================================================================

/**
 * Get suggested topics based on current page/context
 */
export function getSuggestedTopics(
  context: {
    page?: string;
    category?: HelpCategory;
    recentTopics?: string[];
  }
): HelpTopic[] {
  const suggestions: HelpTopic[] = [];

  // Category-based suggestions
  if (context.category) {
    const categoryTopics = HELP_TOPICS.filter(
      (t) => t.category === context.category
    );
    suggestions.push(...categoryTopics.slice(0, 3));
  }

  // Page-based suggestions
  if (context.page) {
    const pageCategory = inferCategoryFromPage(context.page);
    if (pageCategory) {
      const pageTopics = HELP_TOPICS.filter(
        (t) => t.category === pageCategory && !suggestions.includes(t)
      );
      suggestions.push(...pageTopics.slice(0, 2));
    }
  }

  // Fill with getting-started if needed
  if (suggestions.length < 5) {
    const startTopics = HELP_TOPICS.filter(
      (t) => t.category === 'getting-started' && !suggestions.includes(t)
    );
    suggestions.push(...startTopics.slice(0, 5 - suggestions.length));
  }

  return suggestions.slice(0, 5);
}

function inferCategoryFromPage(page: string): HelpCategory | null {
  if (page.includes('mission')) return 'missions';
  if (page.includes('agent')) return 'agents';
  if (page.includes('finding')) return 'findings';
  if (page.includes('graph')) return 'graph';
  if (page.includes('setting')) return 'settings';
  return null;
}

export default searchHelp;
