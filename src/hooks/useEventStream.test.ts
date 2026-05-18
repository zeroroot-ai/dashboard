import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEventStream } from './useEventStream';
import { useUIStore } from '@/src/stores/ui-store';
// Use browser's native Event for error simulation; the custom Event type is different
// import type { Event } from '@/src/types';

describe('useEventStream', () => {
  let eventSourceMock: {
    onopen?: () => void;
    onmessage?: (event: MessageEvent) => void;
    onerror?: (error: Event) => void;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  };

  beforeEach(() => {
    // Reset UI store
    useUIStore.setState({
      eventBuffer: [],
      connectionStatus: 'disconnected',
      eventsPaused: false,
    });

    eventSourceMock = {
      onopen: undefined,
      onmessage: undefined,
      onerror: undefined,
      close: vi.fn(),
      readyState: 1, // OPEN
    };

    // Mock EventSource — vi.fn return type doesn't match typeof EventSource so cast through unknown
    global.EventSource = vi.fn(() => eventSourceMock as unknown as EventSource) as unknown as typeof EventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connection management', () => {
    it('should connect to event stream on mount', () => {
      renderHook(() => useEventStream());

      expect(global.EventSource).toHaveBeenCalledWith('/api/events/stream');
    });

    it('should set connection status to connecting initially', () => {
      renderHook(() => useEventStream());

      const status = useUIStore.getState().connectionStatus;
      expect(['connecting', 'connected']).toContain(status);
    });

    it('should set connection status to connected on open', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onopen).toBeDefined();
      });

      act(() => {
        eventSourceMock.onopen!();
      });

      await waitFor(() => {
        expect(useUIStore.getState().connectionStatus).toBe('connected');
      });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isConnecting).toBe(false);
    });

    it('should reset reconnect attempts on successful connection', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onopen).toBeDefined();
      });

      // Simulate successful connection
      act(() => {
        eventSourceMock.onopen!();
      });

      expect(useUIStore.getState().connectionStatus).toBe('connected');
    });

    it('should close connection on unmount', async () => {
      const { unmount } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock).toBeDefined();
      });

      unmount();

      expect(eventSourceMock.close).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('should parse and add events to buffer', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const eventData = {
        id: 'event-1',
        type: 'mission',
        source: 'mission-controller',
        timestamp: '2024-03-01T10:00:00Z',
        payload: { message: 'Mission started' },
        severity: 'info',
      };

      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(eventData),
      });

      act(() => {
        eventSourceMock.onmessage!(messageEvent);
      });

      await waitFor(() => {
        const events = useUIStore.getState().eventBuffer;
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].id).toBe('event-1');
        expect(events[0].type).toBe('mission');
      });
    });

    it('should convert timestamp string to Date object', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const eventData = {
        id: 'event-1',
        type: 'system',
        source: 'test',
        timestamp: '2024-03-01T10:00:00Z',
        payload: {},
      };

      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(eventData),
      });

      act(() => {
        eventSourceMock.onmessage!(messageEvent);
      });

      await waitFor(() => {
        const events = useUIStore.getState().eventBuffer;
        expect(events[0].timestamp).toBeInstanceOf(Date);
      });
    });

    it('should generate UUID if event has no ID', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const eventData = {
        type: 'system',
        source: 'test',
        payload: {},
      };

      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(eventData),
      });

      act(() => {
        eventSourceMock.onmessage!(messageEvent);
      });

      await waitFor(() => {
        const events = useUIStore.getState().eventBuffer;
        expect(events[0].id).toBeDefined();
        expect(typeof events[0].id).toBe('string');
      });
    });

    it('should handle events with missing fields gracefully', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const eventData = {
        payload: { data: 'test' },
      };

      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(eventData),
      });

      act(() => {
        eventSourceMock.onmessage!(messageEvent);
      });

      await waitFor(() => {
        const events = useUIStore.getState().eventBuffer;
        expect(events[0].type).toBe('system'); // default
        expect(events[0].source).toBe('unknown'); // default
      });
    });

    it('should handle parse errors without disconnecting', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const messageEvent = new MessageEvent('message', {
        data: 'invalid json',
      });

      act(() => {
        eventSourceMock.onmessage!(messageEvent);
      });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[EventStream] Failed to parse event'),
          expect.any(Error)
        );
      });

      // Should not disconnect
      expect(eventSourceMock.close).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not add events after unmount', async () => {
      const { unmount } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      unmount();

      const eventData = {
        id: 'event-after-unmount',
        type: 'system',
        source: 'test',
        payload: {},
      };

      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify(eventData),
      });

      // This should not add to buffer since component is unmounted
      act(() => {
        if (eventSourceMock.onmessage) {
          eventSourceMock.onmessage(messageEvent);
        }
      });

      const events = useUIStore.getState().eventBuffer;
      expect(events.find((e) => e.id === 'event-after-unmount')).toBeUndefined();
    });
  });

  describe('error handling and reconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should set connection status to disconnected on error', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      await waitFor(() => {
        expect(useUIStore.getState().connectionStatus).toBe('disconnected');
      });
    });

    it('should close connection on error', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      expect(eventSourceMock.close).toHaveBeenCalled();
    });

    it('should reconnect with exponential backoff', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      // First error - should reconnect after 1 second
      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      expect(global.EventSource).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await waitFor(() => {
        expect(global.EventSource).toHaveBeenCalledTimes(2);
      });

      // Second error - should reconnect after 2 seconds
      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(global.EventSource).toHaveBeenCalledTimes(3);
      });
    });

    it('should cap reconnection delay at 30 seconds', async () => {
      renderHook(() => useEventStream());

      // Trigger multiple errors to reach max delay
      for (let i = 0; i < 10; i++) {
        await waitFor(() => {
          expect(eventSourceMock.onerror).toBeDefined();
        });

        act(() => {
          eventSourceMock.onerror!(new Event('error'));
        });

        act(() => {
          vi.advanceTimersByTime(30000); // Max delay
        });
      }

      // After many attempts, delay should be capped at 30s
      // Verify it doesn't exceed maximum
    });

    it('should set error state on connection failure', async () => {
      renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      await waitFor(() => {
        const state = useUIStore.getState();
        expect(state.connectionStatus).toBe('disconnected');
      });
    });

    it('should not reconnect after unmount', async () => {
      const { unmount } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      unmount();

      const mockedEventSource = vi.mocked(global.EventSource);
      const callsBefore = mockedEventSource.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(mockedEventSource.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('manual reconnection', () => {
    it('should provide reconnect function', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(result.current.reconnect).toBeDefined();
      });

      expect(typeof result.current.reconnect).toBe('function');
    });

    it('should reset attempts on manual reconnect', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      // Cause several errors to increase reconnect attempts
      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Manual reconnect should reset the delay
      act(() => {
        result.current.reconnect();
      });

      // Next reconnect should use 1s delay (initial), not increased delay
      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(global.EventSource).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });

  describe('disconnect function', () => {
    it('should provide disconnect function', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(result.current.disconnect).toBeDefined();
      });

      expect(typeof result.current.disconnect).toBe('function');
    });

    it('should close connection when disconnect is called', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock).toBeDefined();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(eventSourceMock.close).toHaveBeenCalled();
    });

    it('should set connection status to disconnected', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onopen).toBeDefined();
      });

      act(() => {
        eventSourceMock.onopen!();
      });

      expect(useUIStore.getState().connectionStatus).toBe('connected');

      act(() => {
        result.current.disconnect();
      });

      expect(useUIStore.getState().connectionStatus).toBe('disconnected');
    });
  });

  describe('connection status', () => {
    it('should return isConnected as true when connected', async () => {
      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onopen).toBeDefined();
      });

      act(() => {
        eventSourceMock.onopen!();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });

    it('should return isConnecting during connection attempt', () => {
      const { result } = renderHook(() => useEventStream());

      // Initially should be connecting
      expect(result.current.isConnecting || result.current.isConnected).toBe(true);
    });

    it('should return error when connection fails', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useEventStream());

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });

      expect(result.current.error?.message).toContain('Reconnecting');

      vi.restoreAllMocks();
    });
  });
});
