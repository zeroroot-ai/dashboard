/**
 * WebSocket Hook
 * Manages WebSocket connection with reconnection logic and fallback to polling
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface UseWebSocketOptions {
  url?: string;
  enabled?: boolean;
  reconnectAttempts?: number;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onFallbackMode?: () => void;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnect: () => void;
  lastMessage: WebSocketMessage | null;
  disconnect: () => void;
}

// Constants
const DEFAULT_URL = '/ws/dashboard';
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30000; // 30s
const MESSAGE_THROTTLE_MS = 500; // Batch updates every 500ms

/**
 * Custom hook for managing WebSocket connections with automatic reconnection
 * and fallback to polling mode
 *
 * @param options Configuration options
 * @returns WebSocket connection state and controls
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = DEFAULT_URL,
    enabled = true,
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    onFallbackMode,
  } = options;

  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  // Refs to persist between renders
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageQueueRef = useRef<WebSocketMessage[]>([]);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const fallbackModeRef = useRef(false);

  /**
   * Calculate exponential backoff delay
   */
  const getReconnectDelay = useCallback((): number => {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectCountRef.current),
      MAX_RECONNECT_DELAY
    );
    return delay;
  }, []);

  /**
   * Process queued messages in batches
   */
  const processMessageQueue = useCallback(() => {
    if (messageQueueRef.current.length === 0) return;

    const messages = [...messageQueueRef.current];
    messageQueueRef.current = [];

    // Process each message
    messages.forEach((message) => {
      if (onMessage && isMountedRef.current) {
        onMessage(message);
      }
    });

    // Update last message to the most recent one
    if (messages.length > 0 && isMountedRef.current) {
      setLastMessage(messages[messages.length - 1]);
    }
  }, [onMessage]);

  /**
   * Throttled message handler - batches messages for better performance
   */
  const handleMessage = useCallback((message: WebSocketMessage) => {
    // Add to queue
    messageQueueRef.current.push(message);

    // Clear existing throttle timeout
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
    }

    // Set new throttle timeout
    throttleTimeoutRef.current = setTimeout(() => {
      processMessageQueue();
      throttleTimeoutRef.current = null;
    }, MESSAGE_THROTTLE_MS);
  }, [processMessageQueue]);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!enabled || !isMountedRef.current) return;

    // Don't attempt connection if in fallback mode
    if (fallbackModeRef.current) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      setConnectionState(reconnectCountRef.current > 0 ? 'reconnecting' : 'connecting');

      // Construct WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = url.startsWith('/') ? `${protocol}//${host}${url}` : url;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;

        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebSocket] Connected');
        }
        setConnectionState('connected');
        reconnectCountRef.current = 0;
        onConnect?.();
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;

        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebSocket] Disconnected', event.code, event.reason);
        }
        setConnectionState('disconnected');
        wsRef.current = null;
        onDisconnect?.();

        // Attempt reconnection if not a clean close and attempts remain
        if (!event.wasClean && reconnectCountRef.current < reconnectAttempts) {
          const delay = getReconnectDelay();
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectCountRef.current + 1}/${reconnectAttempts})`);
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current++;
            connect();
          }, delay);
        } else if (reconnectCountRef.current >= reconnectAttempts) {
          // Switch to fallback mode after max attempts
          if (process.env.NODE_ENV !== 'production') {
            console.log('[WebSocket] Max reconnection attempts reached, switching to fallback mode');
          }
          fallbackModeRef.current = true;
          onFallbackMode?.();
        }
      };

      ws.onerror = (error) => {
        if (!isMountedRef.current) return;

        console.error('[WebSocket] Error:', error);
        onError?.(error);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          handleMessage(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      setConnectionState('disconnected');
    }
  }, [enabled, url, reconnectAttempts, onConnect, onDisconnect, onError, onFallbackMode, handleMessage, getReconnectDelay]);

  /**
   * Manually reconnect
   */
  const reconnect = useCallback(() => {
    fallbackModeRef.current = false;
    reconnectCountRef.current = 0;

    // Clear any pending reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    connect();
  }, [connect]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnectionState('disconnected');
  }, []);

  // Initialize connection on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (enabled) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;

      // Clear timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }

      // Process any remaining messages
      if (messageQueueRef.current.length > 0) {
        processMessageQueue();
      }

      // Close connection
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
      }
    };
  }, [enabled, connect, processMessageQueue]);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    reconnect,
    lastMessage,
    disconnect,
  };
}
