import { describe, it, expect } from 'vitest';
import { isScrubbing } from '@/src/lib/graph/fold-scrubber';

describe('isScrubbing (graph live/replay switch)', () => {
  it('is false when the scrubber is closed, even off the tail', () => {
    expect(isScrubbing(false, 10, 3)).toBe(false);
  });

  it('is false at the live tail (seq == total)', () => {
    expect(isScrubbing(true, 10, 10)).toBe(false);
  });

  it('is false past the tail (seq > total is clamped upstream, but guard holds)', () => {
    expect(isScrubbing(true, 10, 11)).toBe(false);
  });

  it('is false when there is no Timeline', () => {
    expect(isScrubbing(true, 0, 0)).toBe(false);
  });

  it('is true when open and scrubbed off the tail', () => {
    expect(isScrubbing(true, 10, 0)).toBe(true);
    expect(isScrubbing(true, 10, 9)).toBe(true);
  });
});
