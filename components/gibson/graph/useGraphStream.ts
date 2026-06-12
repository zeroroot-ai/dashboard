'use client';

/**
 * useGraphStream, Phase 7, Task 22
 *
 * Opens an EventSource on /api/graph/stream when `enabled` is true.
 * On each `event: graph-update`, parses the JSON payload and calls
 * `onUpdate(update)`. Returns `{ healthy, lastEventAt }`.
 *
 * Reconnection: exponential backoff 1 → 2 → 5 → 10 → 30s (cap).
 * The caller is responsible for merging node/edge updates into local
 * state and for driving the polling fallback (Task 23).
 *
 * Spec: dashboard-knowledge-graph Phase 7, Task 22.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

// Backoff schedule in ms: 1s, 2s, 5s, 10s, 30s (then capped at 30s)
const BACKOFF_SCHEDULE = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface GraphStreamUpdate {
  kind: number; // GraphUpdate.Kind enum value
  node?: GraphNode;
  edge?: GraphEdge;
  at: number | null; // epoch ms or null
}

export interface GraphStreamState {
  healthy: boolean;
  lastEventAt: number;
}

type UpdateCallback = (update: GraphStreamUpdate) => void;

export function useGraphStream(
  enabled: boolean,
  onUpdate: UpdateCallback,
): GraphStreamState {
  const [healthy, setHealthy] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number>(0);

  // Stable ref to onUpdate, avoids restart when callback identity changes
  const onUpdateRef = useRef<UpdateCallback>(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const retryCountRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    closeStream();

    const es = new EventSource('/api/graph/stream');
    esRef.current = es;

    es.addEventListener('graph-update', (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      setHealthy(true);
      setLastEventAt(now);
      retryCountRef.current = 0; // reset backoff on successful event

      try {
        const raw = JSON.parse(event.data) as {
          kind?: number;
          at?: number | null;
          node?: {
            id: string;
            labels: string[];
            properties: Record<string, unknown>;
            severity?: string;
          };
          edge?: {
            id: string;
            source: string;
            target: string;
            type: string;
          };
        };

        const update: GraphStreamUpdate = {
          kind: raw.kind ?? 0,
          at: raw.at ?? null,
        };

        if (raw.node) {
          update.node = {
            id: raw.node.id,
            labels: raw.node.labels,
            properties: {
              ...raw.node.properties,
              severity: raw.node.severity,
              // Tag with addedAt for fade-in animation
              addedAt: now,
            },
          };
        }

        if (raw.edge) {
          update.edge = {
            id: raw.edge.id,
            type: raw.edge.type,
            source: raw.edge.source,
            target: raw.edge.target,
            properties: {},
          };
        }

        onUpdateRef.current(update);
      } catch {
        // Malformed event, ignore, stream is still considered healthy
      }
    });

    es.addEventListener('error', (_event: Event) => {
      if (!mountedRef.current) return;
      setHealthy(false);
      closeStream();

      // Schedule reconnect with exponential backoff
      const delay = BACKOFF_SCHEDULE[Math.min(retryCountRef.current, BACKOFF_SCHEDULE.length - 1)];
      retryCountRef.current += 1;

      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    });

    // Handle the custom 'error' SSE event (daemon-side error) as a named event
    es.addEventListener('error', (_e: Event) => {
      // Already handled above via EventSource onerror. Named events fall
      // through to readyState checks. No additional handling needed.
    });
  }, [closeStream, clearRetryTimer]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      closeStream();
      setHealthy(false);
    };
  }, [enabled, connect, clearRetryTimer, closeStream]);

  return { healthy, lastEventAt };
}
