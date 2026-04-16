/**
 * WebSocket Store
 * Zustand store for managing global WebSocket connection state
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ConnectionState } from '@/src/hooks/useWebSocket';

// ============================================================================
// Store State
// ============================================================================

export interface WebSocketState {
  // Connection state
  connectionState: ConnectionState;
  isConnected: boolean;

  // Connection metadata
  lastConnectedAt: Date | null;
  retryCount: number;

  // Actions
  setConnectionState: (state: ConnectionState) => void;
  setConnected: (connected: boolean) => void;
  setLastConnectedAt: (date: Date | null) => void;
  setRetryCount: (count: number) => void;
  incrementRetryCount: () => void;
  resetRetryCount: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  // Initial state
  connectionState: 'disconnected',
  isConnected: false,
  lastConnectedAt: null,
  retryCount: 0,

  // Set connection state
  setConnectionState: (state: ConnectionState) => {
    set({ connectionState: state });

    // Update connected flag
    if (state === 'connected') {
      set({
        isConnected: true,
        lastConnectedAt: new Date(),
        retryCount: 0,
      });
    } else {
      set({ isConnected: false });
    }
  },

  // Set connected flag
  setConnected: (connected: boolean) => {
    set({ isConnected: connected });
  },

  // Set last connected timestamp
  setLastConnectedAt: (date: Date | null) => {
    set({ lastConnectedAt: date });
  },

  // Set retry count
  setRetryCount: (count: number) => {
    set({ retryCount: count });
  },

  // Increment retry count
  incrementRetryCount: () => {
    set({ retryCount: get().retryCount + 1 });
  },

  // Reset retry count
  resetRetryCount: () => {
    set({ retryCount: 0 });
  },
}));

// ============================================================================
// Selectors (convenience hooks)
// ============================================================================

/**
 * Hook to get connection state
 */
export const useConnectionState = () =>
  useWebSocketStore((state) => state.connectionState);

/**
 * Hook to check if connected
 */
export const useIsConnected = () =>
  useWebSocketStore((state) => state.isConnected);

/**
 * Hook to get last connected timestamp
 */
export const useLastConnectedAt = () =>
  useWebSocketStore((state) => state.lastConnectedAt);

/**
 * Hook to get retry count
 */
export const useRetryCount = () =>
  useWebSocketStore((state) => state.retryCount);

/**
 * Hook to get WebSocket actions
 */
export const useWebSocketActions = () =>
  useWebSocketStore(
    useShallow((state) => ({
      setConnectionState: state.setConnectionState,
      setConnected: state.setConnected,
      setLastConnectedAt: state.setLastConnectedAt,
      setRetryCount: state.setRetryCount,
      incrementRetryCount: state.incrementRetryCount,
      resetRetryCount: state.resetRetryCount,
    }))
  );

/**
 * Hook to get all WebSocket state for ConnectionStatus component
 */
export const useWebSocketStatus = () =>
  useWebSocketStore(
    useShallow((state) => ({
      connectionState: state.connectionState,
      isConnected: state.isConnected,
      lastConnectedAt: state.lastConnectedAt,
      retryCount: state.retryCount,
    }))
  );
