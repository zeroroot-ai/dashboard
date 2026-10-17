// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useJobEvents } from '@/src/hooks/useJobs';

// A fake EventSource that records each stream the hook opens.
class FakeEventSource {
  static opened: FakeEventSource[] = [];
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.opened.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    this.listeners.get(name)?.({ data } as MessageEvent<string>);
  }
}

afterEach(() => {
  FakeEventSource.opened = [];
  vi.unstubAllGlobals();
});

describe('useJobEvents with the default opener', () => {
  it('keeps one stream across rerenders, so an event shows once', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { result, rerender } = renderHook(() => useJobEvents('job-1'));
    act(() => {
      FakeEventSource.opened[0]!.emit('job', JSON.stringify({ seq: '1', kind: 'note' }));
    });
    rerender();
    rerender();

    expect(FakeEventSource.opened).toHaveLength(1);
    expect(result.current.events).toHaveLength(1);
  });

  it('opens a new stream and starts an empty feed for a new job', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { result, rerender } = renderHook(({ id }) => useJobEvents(id), {
      initialProps: { id: 'job-1' },
    });
    act(() => {
      FakeEventSource.opened[0]!.emit('job', JSON.stringify({ seq: '1', kind: 'note' }));
    });
    rerender({ id: 'job-2' });

    expect(FakeEventSource.opened).toHaveLength(2);
    expect(FakeEventSource.opened[0]!.closed).toBe(true);
    expect(result.current.events).toHaveLength(0);
  });
});
