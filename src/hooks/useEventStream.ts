// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
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
/**
 * Create an EventSource. On failure it reports the error through onFail and
 * returns null, so the caller sets no state on this path itself.
 */
function openEventSource(url: string, onFail: (err: Error) => void): EventSource | null {
  try {
    return new EventSource(url);
  } catch (err) {
    onFail(err instanceof Error ? err : new Error("Failed to connect"));
    return null;
  }
}

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

  // The reconnect timers call the latest connect through this ref, so connect
  // does not refer to itself. The ref takes connect after each commit.
  const connectRef = useRef<() => void>(() => {});

  // The stream could not be created: report it and schedule a retry.
  const failToConnect = useCallback(
    (err: Error) => {
      setConnectionStatus("disconnected");
      setError(err);
      const delay = getReconnectDelay();
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          reconnectAttemptsRef.current += 1;
          connectRef.current();
        }
      }, delay);
    },
    [setConnectionStatus, getReconnectDelay],
  );

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

    // The error clears when the stream opens (onopen) or when the user asks
    // for a reconnect, not here, so the mount effect sets no React state.
    setConnectionStatus("connecting");

    const eventSource = openEventSource("/api/events/stream", failToConnect);
    if (!eventSource) return;
    {
      eventSourceRef.current = eventSource;

      // Connection opened
      eventSource.onopen = () => {
        if (!mountedRef.current) return;
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
        } catch {
          // Don't disconnect on parse errors
        }
      };

      // Error occurred
      eventSource.onerror = () => {
        if (!mountedRef.current) return;

        setConnectionStatus("disconnected");

        // Close the current connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Schedule reconnection with exponential backoff
        const delay = getReconnectDelay();

        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            reconnectAttemptsRef.current += 1;
            connectRef.current();
          }
        }, delay);

        setError(
          new Error(
            `Connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s...`
          )
        );
      };
    }
  }, [addEvent, setConnectionStatus, failToConnect, getReconnectDelay]);
  useLayoutEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0; // Reset attempts on manual reconnect
    setError(null);
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
