"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useUIStore } from "@/src/stores/ui-store";
import type { Event } from "@/src/types";

/**
 * useEventStream hook manages SSE connection to /api/events/stream.
 * Features:
 * - Automatic connection on mount
 * - Exponential backoff reconnection (1s, 2s, 4s, 8s, max 30s)
 * - Updates Zustand connectionStatus and eventBuffer
 * - Graceful cleanup on unmount
 */
export function useEventStream() {
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  const addEvent = useUIStore((state) => state.addEvent);
  const setConnectionStatus = useUIStore((state) => state.setConnectionStatus);
  const connectionStatus = useUIStore((state) => state.connectionStatus);

  /**
   * Calculate exponential backoff delay
   * 1s, 2s, 4s, 8s, 16s, 30s (max)
   */
  const getReconnectDelay = useCallback(() => {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(
      baseDelay * Math.pow(2, reconnectAttemptsRef.current),
      maxDelay
    );
    return delay;
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

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (!mountedRef.current) return;

    setConnectionStatus("connecting");
    setError(null);

    try {
      const eventSource = new EventSource("/api/events/stream");
      eventSourceRef.current = eventSource;

      // Connection opened
      eventSource.onopen = () => {
        if (!mountedRef.current) return;
        console.log("[EventStream] Connected to event stream");
        setConnectionStatus("connected");
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
        setError(null);
      };

      // Message received
      eventSource.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          // Parse the event data
          const parsedEvent: Event = {
            id: data.id || crypto.randomUUID(),
            type: data.type || "system",
            source: data.source || "unknown",
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            payload: data.payload || data,
            severity: data.severity,
            missionId: data.missionId,
          };

          // Add to event buffer
          addEvent(parsedEvent);
        } catch (err) {
          console.error("[EventStream] Failed to parse event:", err);
          // Don't disconnect on parse errors, just log them
        }
      };

      // Error occurred
      eventSource.onerror = (event) => {
        if (!mountedRef.current) return;

        console.error("[EventStream] Connection error:", event);
        setConnectionStatus("disconnected");

        // Close the current connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Schedule reconnection with exponential backoff
        const delay = getReconnectDelay();
        console.log(
          `[EventStream] Reconnecting in ${delay / 1000}s (attempt ${
            reconnectAttemptsRef.current + 1
          })`
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            reconnectAttemptsRef.current += 1;
            connect();
          }
        }, delay);

        setError(
          new Error(
            `Connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s...`
          )
        );
      };
    } catch (err) {
      console.error("[EventStream] Failed to create EventSource:", err);
      setConnectionStatus("disconnected");
      setError(err instanceof Error ? err : new Error("Failed to connect"));

      // Schedule reconnection
      const delay = getReconnectDelay();
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          reconnectAttemptsRef.current += 1;
          connect();
        }
      }, delay);
    }
  }, [addEvent, setConnectionStatus, getReconnectDelay]);

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
    setConnectionStatus("disconnected");
  }, [setConnectionStatus]);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected: connectionStatus === "connected",
    isConnecting: connectionStatus === "connecting",
    error,
    reconnect,
    disconnect,
  };
}
