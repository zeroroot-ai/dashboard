'use client';

/**
 * useGraphSSE Hook
 *
 * Manages Server-Sent Events (SSE) connection for real-time graph updates.
 * Handles connection lifecycle, reconnection with exponential backoff, and
 * event parsing.
 *
 * Features:
 * - Automatic connection on mount
 * - Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s)
 * - Maximum 5 reconnection attempts
 * - Event parsing and validation
 * - Connection status tracking
 * - Graceful cleanup on unmount
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * SSE event types for graph updates
 */
export type SSEEventType =
  | 'node-added'
  | 'node-updated'
  | 'node-deleted'
  | 'edge-added'
  | 'edge-deleted'
  | 'graph-reset'
  | 'heartbeat';

/**
 * Base SSE event structure
 */
export interface GraphSSEEvent {
  type: SSEEventType;
  timestamp: string;
  data: unknown;
}

/**
 * Node added event
 */
export interface NodeAddedEvent extends GraphSSEEvent {
  type: 'node-added';
  data: {
    id: string;
    labels: string[];
    properties: Record<string, unknown>;
  };
}

/**
 * Node updated event
 */
export interface NodeUpdatedEvent extends GraphSSEEvent {
  type: 'node-updated';
  data: {
    id: string;
    properties: Record<string, unknown>;
  };
}

/**
 * Node deleted event
 */
export interface NodeDeletedEvent extends GraphSSEEvent {
  type: 'node-deleted';
  data: {
    id: string;
  };
}

/**
 * Edge added event
 */
export interface EdgeAddedEvent extends GraphSSEEvent {
  type: 'edge-added';
  data: {
    id: string;
    type: string;
    source: string;
    target: string;
    properties: Record<string, unknown>;
  };
}

/**
 * Edge deleted event
 */
export interface EdgeDeletedEvent extends GraphSSEEvent {
  type: 'edge-deleted';
  data: {
    id: string;
  };
}

/**
 * Graph reset event
 */
export interface GraphResetEvent extends GraphSSEEvent {
  type: 'graph-reset';
  data: {
    reason: string;
  };
}

/**
 * Connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Hook return value
 */
export interface UseGraphSSEReturn {
  status: ConnectionStatus;
  events: GraphSSEEvent[];
  lastEvent: GraphSSEEvent | null;
  reconnect: () => void;
  error: Error | null;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1 second
const INITIAL_CONNECTION_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useGraphSSE - Manage SSE connection for real-time graph updates
 *
 * @param url - SSE endpoint URL
 * @param missionId - Optional mission ID to filter events
 * @returns Connection status, events, and control functions
 *
 * @example
 * ```tsx
 * function GraphComponent() {
 *   const { status, events, lastEvent, reconnect } = useGraphSSE(
 *     '/api/graph/stream',
 *     'mission-123'
 *   );
 *
 *   useEffect(() => {
 *     if (lastEvent?.type === 'node-added') {
 *       // Handle new node
 *       // Handle new node, lastEvent.data contains the updated graph node
 *     }
 *   }, [lastEvent]);
 *
 *   return (
 *     <div>
 *       <p>Status: {status}</p>
 *       {status === 'error' && <button onClick={reconnect}>Retry</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useGraphSSE(
  url: string,
  missionId?: string
): UseGraphSSEReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [events, setEvents] = useState<GraphSSEEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<GraphSSEEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Calculate exponential backoff delay
   */
  const getReconnectDelay = useCallback(() => {
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
      BASE_RECONNECT_DELAY * 16 // Max 16 seconds
    );
    return delay;
  }, []);

  /**
   * Parse and validate SSE event
   */
  const parseEvent = useCallback((eventData: string): GraphSSEEvent | null => {
    try {
      const parsed = JSON.parse(eventData);

      // Validate event structure
      if (!parsed.type || !parsed.timestamp) {
        return null;
      }

      // Validate event type
      const validTypes: SSEEventType[] = [
        'node-added',
        'node-updated',
        'node-deleted',
        'edge-added',
        'edge-deleted',
        'graph-reset',
        'heartbeat',
      ];

      if (!validTypes.includes(parsed.type)) {
        return null;
      }

      return parsed as GraphSSEEvent;
    } catch {
      return null;
    }
  }, []);

  /**
   * Connect to SSE stream
   */
  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Clear any pending timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (!mountedRef.current) return;

    // Check if we've exceeded max attempts
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('error');
      setError(new Error('Maximum reconnection attempts exceeded'));
      return;
    }

    setStatus('connecting');
    setError(null);

    try {
      // Build URL with mission ID if provided
      const sseUrl = missionId ? `${url}?missionId=${missionId}` : url;

      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (status === 'connecting') {
          eventSource.close();
          setStatus('error');
          setError(new Error('Connection timeout'));

          // Attempt reconnection
          const delay = getReconnectDelay();
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              reconnectAttemptsRef.current += 1;
              connect();
            }
          }, delay);
        }
      }, INITIAL_CONNECTION_TIMEOUT);

      // Connection opened
      eventSource.onopen = () => {
        if (!mountedRef.current) return;

        setStatus('connected');
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        setError(null);

        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      };

      // Message received
      eventSource.onmessage = (event) => {
        if (!mountedRef.current) return;

        const parsedEvent = parseEvent(event.data);
        if (!parsedEvent) return;

        // Skip heartbeat events (don't store them)
        if (parsedEvent.type === 'heartbeat') {
          return;
        }

        // Update state
        setLastEvent(parsedEvent);
        setEvents((prev) => [...prev, parsedEvent]);

      };

      // Error occurred
      eventSource.onerror = () => {
        if (!mountedRef.current) return;

        setStatus('disconnected');

        // Close the current connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }

        // Check if we should attempt reconnection
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              reconnectAttemptsRef.current += 1;
              connect();
            }
          }, delay);

          setError(
            new Error(
              `Connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s... (${
                reconnectAttemptsRef.current + 1
              }/${MAX_RECONNECT_ATTEMPTS})`
            )
          );
        } else {
          setStatus('error');
          setError(new Error('Maximum reconnection attempts exceeded'));
        }
      };
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error('Failed to connect'));

      // Attempt reconnection if under max attempts
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = getReconnectDelay();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            reconnectAttemptsRef.current += 1;
            connect();
          }
        }, delay);
      }
    }
  }, [url, missionId, parseEvent, getReconnectDelay, status]);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0; // Reset attempts on manual reconnect
    connect();
  }, [connect]);

  /**
   * Disconnect and cleanup
   */
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  // Connect on mount and when URL or missionId changes
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    events,
    lastEvent,
    reconnect,
    error,
  };
}
