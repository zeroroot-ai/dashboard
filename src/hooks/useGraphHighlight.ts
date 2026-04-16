/**
 * useGraphHighlight Hook
 *
 * Manages graph node highlighting based on chat context.
 * When nodes are mentioned in chat messages, this hook provides
 * highlighting state to the graph visualization.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useChatGraphContext } from '@/src/stores/chat-store';

// ============================================================================
// Types
// ============================================================================

export interface HighlightedNode {
  id: string;
  label?: string;
  type?: string;
  reason: 'selected' | 'mentioned' | 'related';
}

export interface GraphHighlightState {
  /** Currently highlighted node IDs */
  highlightedNodeIds: Set<string>;
  /** Detailed highlight info per node */
  highlights: Map<string, HighlightedNode>;
  /** Primary selected node (from chat context) */
  primaryNodeId: string | null;
  /** Whether highlighting is active */
  isHighlighting: boolean;
}

export interface UseGraphHighlightReturn {
  /** Current highlight state */
  state: GraphHighlightState;
  /** Highlight a specific node */
  highlightNode: (nodeId: string, reason?: HighlightedNode['reason']) => void;
  /** Highlight multiple nodes */
  highlightNodes: (nodeIds: string[], reason?: HighlightedNode['reason']) => void;
  /** Clear all highlights */
  clearHighlights: () => void;
  /** Clear a specific highlight */
  clearHighlight: (nodeId: string) => void;
  /** Check if a node is highlighted */
  isNodeHighlighted: (nodeId: string) => boolean;
  /** Get highlight info for a node */
  getHighlightInfo: (nodeId: string) => HighlightedNode | undefined;
  /** Parse node references from text */
  parseNodeReferences: (text: string) => string[];
  /** Highlight nodes mentioned in text */
  highlightFromText: (text: string, nodeIdMap: Map<string, string>) => void;
}

// ============================================================================
// Constants
// ============================================================================

// Pattern to match node references in chat messages
// Supports formats like: [NodeName], @NodeName, #node-id, `node-id`
const NODE_REFERENCE_PATTERNS = [
  /\[([^\]]+)\]/g, // [NodeName]
  /@(\w[\w\-\.]+)/g, // @NodeName
  /#([\w\-]+)/g, // #node-id
  /`([^`]+)`/g, // `node-id`
];

// ============================================================================
// Hook
// ============================================================================

export function useGraphHighlight(): UseGraphHighlightReturn {
  const { graphContext } = useChatGraphContext();

  // State
  const [highlights, setHighlights] = useState<Map<string, HighlightedNode>>(
    new Map()
  );

  // Derived state
  const highlightedNodeIds = useMemo(
    () => new Set(highlights.keys()),
    [highlights]
  );

  const primaryNodeId = graphContext?.nodeId || null;

  const isHighlighting = highlightedNodeIds.size > 0 || primaryNodeId !== null;

  // Sync primary node from chat context
  useEffect(() => {
    if (graphContext?.nodeId) {
      setHighlights((prev) => {
        const next = new Map(prev);
        // Clear previous 'selected' highlights
        for (const [id, highlight] of next) {
          if (highlight.reason === 'selected') {
            next.delete(id);
          }
        }
        // Add new selected node
        next.set(graphContext.nodeId!, {
          id: graphContext.nodeId!,
          label: graphContext.nodeLabel,
          type: graphContext.nodeType,
          reason: 'selected',
        });
        return next;
      });
    }
  }, [graphContext?.nodeId, graphContext?.nodeLabel, graphContext?.nodeType]);

  /**
   * Highlight a specific node
   */
  const highlightNode = useCallback(
    (nodeId: string, reason: HighlightedNode['reason'] = 'mentioned') => {
      setHighlights((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { id: nodeId, reason });
        return next;
      });
    },
    []
  );

  /**
   * Highlight multiple nodes
   */
  const highlightNodes = useCallback(
    (nodeIds: string[], reason: HighlightedNode['reason'] = 'mentioned') => {
      setHighlights((prev) => {
        const next = new Map(prev);
        for (const nodeId of nodeIds) {
          next.set(nodeId, { id: nodeId, reason });
        }
        return next;
      });
    },
    []
  );

  /**
   * Clear all highlights
   */
  const clearHighlights = useCallback(() => {
    setHighlights(new Map());
  }, []);

  /**
   * Clear a specific highlight
   */
  const clearHighlight = useCallback((nodeId: string) => {
    setHighlights((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  /**
   * Check if a node is highlighted
   */
  const isNodeHighlighted = useCallback(
    (nodeId: string) => {
      return highlightedNodeIds.has(nodeId) || nodeId === primaryNodeId;
    },
    [highlightedNodeIds, primaryNodeId]
  );

  /**
   * Get highlight info for a node
   */
  const getHighlightInfo = useCallback(
    (nodeId: string) => {
      return highlights.get(nodeId);
    },
    [highlights]
  );

  /**
   * Parse node references from text
   * Extracts potential node IDs/names from chat messages
   */
  const parseNodeReferences = useCallback((text: string): string[] => {
    const references: Set<string> = new Set();

    for (const pattern of NODE_REFERENCE_PATTERNS) {
      // Reset pattern lastIndex for each iteration
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const reference = match[1].trim();
        if (reference.length > 0) {
          references.add(reference);
        }
      }
    }

    return Array.from(references);
  }, []);

  /**
   * Highlight nodes mentioned in text
   * Uses a map to resolve text references to actual node IDs
   */
  const highlightFromText = useCallback(
    (text: string, nodeIdMap: Map<string, string>) => {
      const references = parseNodeReferences(text);
      const nodeIds: string[] = [];

      for (const ref of references) {
        // Try exact match first
        if (nodeIdMap.has(ref)) {
          nodeIds.push(nodeIdMap.get(ref)!);
          continue;
        }

        // Try case-insensitive match
        const lowerRef = ref.toLowerCase();
        for (const [key, value] of nodeIdMap) {
          if (key.toLowerCase() === lowerRef) {
            nodeIds.push(value);
            break;
          }
        }
      }

      if (nodeIds.length > 0) {
        highlightNodes(nodeIds, 'mentioned');
      }
    },
    [parseNodeReferences, highlightNodes]
  );

  // Build state object
  const state: GraphHighlightState = useMemo(
    () => ({
      highlightedNodeIds,
      highlights,
      primaryNodeId,
      isHighlighting,
    }),
    [highlightedNodeIds, highlights, primaryNodeId, isHighlighting]
  );

  return {
    state,
    highlightNode,
    highlightNodes,
    clearHighlights,
    clearHighlight,
    isNodeHighlighted,
    getHighlightInfo,
    parseNodeReferences,
    highlightFromText,
  };
}

export default useGraphHighlight;
