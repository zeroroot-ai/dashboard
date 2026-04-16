/**
 * Performance Optimization Utilities
 *
 * Optimizations for team management components including:
 * - Virtual scrolling for large lists
 * - Memoization helpers
 * - Debouncing and throttling
 * - Lazy loading utilities
 * - Performance monitoring
 */

// ============================================================================
// Types
// ============================================================================

export interface VirtualScrollOptions<T> {
  /** All items to virtualize */
  items: T[];
  /** Height of each item in pixels */
  itemHeight: number;
  /** Height of the container */
  containerHeight: number;
  /** Current scroll position */
  scrollTop: number;
  /** Extra items to render above/below visible area */
  overscan?: number;
}

export interface VirtualScrollResult<T> {
  /** Items to render */
  visibleItems: T[];
  /** Starting index of visible items */
  startIndex: number;
  /** Ending index of visible items */
  endIndex: number;
  /** Total height of all items */
  totalHeight: number;
  /** Offset from top for the first visible item */
  offsetY: number;
}

export interface DebounceOptions {
  /** Delay in milliseconds */
  delay: number;
  /** Execute immediately on first call */
  leading?: boolean;
  /** Execute on trailing edge */
  trailing?: boolean;
  /** Maximum wait time */
  maxWait?: number;
}

export interface PerformanceMark {
  name: string;
  startTime: number;
  duration?: number;
}

// ============================================================================
// Virtual Scrolling
// ============================================================================

/**
 * Calculate visible items for virtual scrolling
 */
export function virtualizeList<T>(
  options: VirtualScrollOptions<T>
): VirtualScrollResult<T> {
  const {
    items,
    itemHeight,
    containerHeight,
    scrollTop,
    overscan = 3,
  } = options;

  const totalHeight = items.length * itemHeight;

  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const endIndex = Math.min(items.length, startIndex + visibleCount + overscan * 2);

  // Extract visible items
  const visibleItems = items.slice(startIndex, endIndex);

  // Calculate offset
  const offsetY = startIndex * itemHeight;

  return {
    visibleItems,
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
  };
}

/**
 * Hook-friendly virtualization state
 */
export function createVirtualizer<T>(
  items: T[],
  options: {
    itemHeight: number;
    containerHeight: number;
    overscan?: number;
  }
) {
  let scrollTop = 0;

  return {
    getVirtualItems: () => virtualizeList({
      items,
      itemHeight: options.itemHeight,
      containerHeight: options.containerHeight,
      scrollTop,
      overscan: options.overscan,
    }),

    setScrollTop: (value: number) => {
      scrollTop = value;
    },

    scrollToIndex: (index: number, align: 'start' | 'center' | 'end' = 'start') => {
      const targetOffset = index * options.itemHeight;

      switch (align) {
        case 'start':
          scrollTop = targetOffset;
          break;
        case 'center':
          scrollTop = targetOffset - options.containerHeight / 2 + options.itemHeight / 2;
          break;
        case 'end':
          scrollTop = targetOffset - options.containerHeight + options.itemHeight;
          break;
      }

      return Math.max(0, scrollTop);
    },
  };
}

// ============================================================================
// Debouncing and Throttling
// ============================================================================

/**
 * Debounce a function call
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: DebounceOptions | number
): T & { cancel: () => void; flush: () => void } {
  const opts = typeof options === 'number'
    ? { delay: options, leading: false, trailing: true }
    : { leading: false, trailing: true, ...options };

  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime: number | null = null;
  let lastInvokeTime = 0;
  let result: ReturnType<T>;

  function invokeFunc(): ReturnType<T> {
    const args = lastArgs!;
    lastArgs = null;
    lastInvokeTime = Date.now();
    result = fn(...args) as ReturnType<T>;
    return result;
  }

  function shouldInvoke(time: number): boolean {
    const timeSinceLastCall = lastCallTime ? time - lastCallTime : 0;
    const timeSinceLastInvoke = time - lastInvokeTime;

    return (
      lastCallTime === null ||
      timeSinceLastCall >= opts.delay ||
      (opts.maxWait !== undefined && timeSinceLastInvoke >= opts.maxWait)
    );
  }

  function trailingEdge(): void {
    timeoutId = null;

    if (opts.trailing && lastArgs) {
      invokeFunc();
    }
    lastArgs = null;
  }

  function leadingEdge(time: number): void {
    lastInvokeTime = time;

    if (opts.leading) {
      invokeFunc();
    }

    timeoutId = setTimeout(trailingEdge, opts.delay);
  }

  function debounced(this: unknown, ...args: Parameters<T>): ReturnType<T> | undefined {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastCallTime = time;

    if (isInvoking && timeoutId === null) {
      leadingEdge(time);
      return result;
    }

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(trailingEdge, opts.delay);

    return result;
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
    lastCallTime = null;
  };

  debounced.flush = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      if (lastArgs) {
        invokeFunc();
      }
    }
  };

  return debounced as T & { cancel: () => void; flush: () => void };
}

/**
 * Throttle a function call
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): T & { cancel: () => void } {
  const { leading = true, trailing = true } = options;

  let timeoutId: NodeJS.Timeout | null = null;
  let lastCallTime: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  function invokeFunc(): void {
    const args = lastArgs!;
    lastArgs = null;
    lastCallTime = Date.now();
    fn(...args);
  }

  function trailingEdge(): void {
    timeoutId = null;
    if (trailing && lastArgs) {
      invokeFunc();
    }
  }

  function throttled(this: unknown, ...args: Parameters<T>): void {
    const now = Date.now();
    const timeSinceLastCall = lastCallTime ? now - lastCallTime : wait;

    lastArgs = args;

    if (timeSinceLastCall >= wait) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (leading || lastCallTime !== null) {
        invokeFunc();
      } else {
        lastCallTime = now;
        timeoutId = setTimeout(trailingEdge, wait);
      }
    } else if (timeoutId === null && trailing) {
      timeoutId = setTimeout(trailingEdge, wait - timeSinceLastCall);
    }
  }

  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastCallTime = null;
    lastArgs = null;
  };

  return throttled as T & { cancel: () => void };
}

// ============================================================================
// Memoization
// ============================================================================

/**
 * Create a memoized function with LRU cache
 */
export function memoize<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: {
    maxSize?: number;
    keyFn?: (...args: Parameters<T>) => string;
    ttl?: number;
  } = {}
): T & { clear: () => void; size: () => number } {
  const { maxSize = 100, keyFn, ttl } = options;

  interface CacheEntry {
    value: ReturnType<T>;
    timestamp: number;
  }

  const cache = new Map<string, CacheEntry>();
  const accessOrder: string[] = [];

  function getKey(args: Parameters<T>): string {
    if (keyFn) {
      return keyFn(...args);
    }
    return JSON.stringify(args);
  }

  function isExpired(entry: CacheEntry): boolean {
    if (ttl === undefined) return false;
    return Date.now() - entry.timestamp > ttl;
  }

  function evictLRU(): void {
    while (cache.size >= maxSize && accessOrder.length > 0) {
      const oldestKey = accessOrder.shift()!;
      cache.delete(oldestKey);
    }
  }

  function updateAccessOrder(key: string): void {
    const index = accessOrder.indexOf(key);
    if (index > -1) {
      accessOrder.splice(index, 1);
    }
    accessOrder.push(key);
  }

  function memoized(this: unknown, ...args: Parameters<T>): ReturnType<T> {
    const key = getKey(args);
    const cached = cache.get(key);

    if (cached && !isExpired(cached)) {
      updateAccessOrder(key);
      return cached.value;
    }

    evictLRU();

    const result = fn.apply(this, args) as ReturnType<T>;

    cache.set(key, {
      value: result,
      timestamp: Date.now(),
    });

    updateAccessOrder(key);

    return result;
  }

  memoized.clear = () => {
    cache.clear();
    accessOrder.length = 0;
  };

  memoized.size = () => cache.size;

  return memoized as T & { clear: () => void; size: () => number };
}

// ============================================================================
// Lazy Loading
// ============================================================================

/**
 * Create a lazy-loaded module
 */
export function lazyLoad<T>(
  factory: () => Promise<T>,
  options: { timeout?: number } = {}
): () => Promise<T> {
  const { timeout = 10000 } = options;

  let cached: T | null = null;
  let loading: Promise<T> | null = null;

  return async () => {
    if (cached) return cached;

    if (loading) return loading;

    loading = new Promise<T>(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Lazy load timeout'));
      }, timeout);

      try {
        cached = await factory();
        clearTimeout(timeoutId);
        resolve(cached);
      } catch (error) {
        clearTimeout(timeoutId);
        loading = null;
        reject(error);
      }
    });

    return loading;
  };
}

/**
 * Intersection Observer based lazy loading trigger
 */
export function createLazyLoadTrigger(
  callback: () => void,
  options: IntersectionObserverInit = {}
): IntersectionObserver {
  const defaultOptions: IntersectionObserverInit = {
    root: null,
    rootMargin: '100px',
    threshold: 0,
    ...options,
  };

  return new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        callback();
      }
    });
  }, defaultOptions);
}

// ============================================================================
// Performance Monitoring
// ============================================================================

const performanceMarks: Map<string, PerformanceMark> = new Map();

/**
 * Start a performance measurement
 */
export function startMeasure(name: string): void {
  if (typeof performance === 'undefined') return;

  performanceMarks.set(name, {
    name,
    startTime: performance.now(),
  });

  if (performance.mark) {
    performance.mark(`${name}-start`);
  }
}

/**
 * End a performance measurement and return duration
 */
export function endMeasure(name: string): number | null {
  if (typeof performance === 'undefined') return null;

  const mark = performanceMarks.get(name);
  if (!mark) return null;

  const duration = performance.now() - mark.startTime;
  mark.duration = duration;

  if (performance.mark && performance.measure) {
    performance.mark(`${name}-end`);
    try {
      performance.measure(name, `${name}-start`, `${name}-end`);
    } catch {
      // Ignore errors from missing marks
    }
  }

  performanceMarks.delete(name);

  return duration;
}

/**
 * Log performance if duration exceeds threshold
 */
export function measureWithThreshold(
  name: string,
  fn: () => void,
  thresholdMs: number = 16
): void {
  startMeasure(name);
  fn();
  const duration = endMeasure(name);

  if (duration !== null && duration > thresholdMs) {
    console.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`);
  }
}

/**
 * Create a performance-monitored version of a function
 */
export function withPerformanceLogging<T extends (...args: unknown[]) => unknown>(
  fn: T,
  name: string,
  options: { threshold?: number; sampleRate?: number } = {}
): T {
  const { threshold = 16, sampleRate = 1 } = options;

  return ((...args: Parameters<T>): ReturnType<T> => {
    // Sample rate check
    if (Math.random() > sampleRate) {
      return fn(...args) as ReturnType<T>;
    }

    startMeasure(name);
    const result = fn(...args);
    const duration = endMeasure(name);

    if (duration !== null && duration > threshold) {
      console.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms`);
    }

    return result as ReturnType<T>;
  }) as T;
}

// ============================================================================
// Request Coalescing
// ============================================================================

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();

/**
 * Coalesce identical requests made within a time window
 */
export function coalesceRequests<T>(
  key: string,
  requestFn: () => Promise<T>,
  windowMs: number = 100
): Promise<T> {
  const now = Date.now();
  const pending = pendingRequests.get(key) as PendingRequest<T> | undefined;

  // Return existing promise if within window
  if (pending && now - pending.timestamp < windowMs) {
    return pending.promise;
  }

  // Create new request
  const promise = requestFn().finally(() => {
    // Clean up after request completes
    setTimeout(() => {
      pendingRequests.delete(key);
    }, windowMs);
  });

  pendingRequests.set(key, {
    promise,
    timestamp: now,
  });

  return promise;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Batch multiple items for processing
 */
export function createBatcher<T, R>(
  processFn: (items: T[]) => Promise<R[]>,
  options: {
    maxBatchSize?: number;
    maxWaitMs?: number;
  } = {}
): (item: T) => Promise<R> {
  const { maxBatchSize = 10, maxWaitMs = 50 } = options;

  let batch: T[] = [];
  let resolvers: Array<{ resolve: (value: R) => void; reject: (error: Error) => void }> = [];
  let timeoutId: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    if (batch.length === 0) return;

    const currentBatch = batch;
    const currentResolvers = resolvers;

    batch = [];
    resolvers = [];
    timeoutId = null;

    try {
      const results = await processFn(currentBatch);
      results.forEach((result, index) => {
        currentResolvers[index].resolve(result);
      });
    } catch (error) {
      currentResolvers.forEach((resolver) => {
        resolver.reject(error instanceof Error ? error : new Error(String(error)));
      });
    }
  }

  return (item: T): Promise<R> => {
    return new Promise((resolve, reject) => {
      batch.push(item);
      resolvers.push({ resolve, reject });

      if (batch.length >= maxBatchSize) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        flush();
      } else if (!timeoutId) {
        timeoutId = setTimeout(flush, maxWaitMs);
      }
    });
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all performance marks (for testing)
 */
export function clearPerformanceMarks(): void {
  performanceMarks.clear();
  if (typeof performance !== 'undefined' && performance.clearMarks) {
    performance.clearMarks();
    performance.clearMeasures();
  }
}

/**
 * Clear pending requests (for testing)
 */
export function clearPendingRequests(): void {
  pendingRequests.clear();
}
