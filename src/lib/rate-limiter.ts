/**
 * Rate Limiting System
 *
 * Redis-backed rate limiting for API endpoints.
 * Provides:
 * - Fixed window rate limiting
 * - Sliding window rate limiting
 * - Token bucket algorithm
 * - Per-user and per-IP limiting
 * - Configurable limits per endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

// ============================================================================
// Types
// ============================================================================

export type RateLimitAlgorithm = 'fixed_window' | 'sliding_window' | 'token_bucket';

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Algorithm to use */
  algorithm?: RateLimitAlgorithm;
  /** Identifier type */
  identifier?: 'ip' | 'user' | 'ip_and_user' | 'custom';
  /** Skip rate limiting for certain conditions */
  skip?: (request: NextRequest) => boolean;
  /** Custom key generator */
  keyGenerator?: (request: NextRequest) => string | null;
  /** Response message when rate limited */
  message?: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current count of requests */
  current: number;
  /** Maximum allowed requests */
  limit: number;
  /** Remaining requests in window */
  remaining: number;
  /** Time until reset (in seconds) */
  resetIn: number;
  /** Unix timestamp when limit resets */
  resetAt: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Configuration Presets
// ============================================================================

/**
 * Rate limit presets for common use cases
 */
export const RATE_LIMIT_PRESETS = {
  /** Standard API endpoint */
  standard: {
    maxRequests: 100,
    windowSeconds: 60,
    algorithm: 'sliding_window' as const,
  },

  /** Sensitive endpoints (login, password reset) */
  sensitive: {
    maxRequests: 10,
    windowSeconds: 60,
    algorithm: 'fixed_window' as const,
  },

  /** Invitation endpoints */
  invitation: {
    maxRequests: 20,
    windowSeconds: 3600, // 1 hour
    algorithm: 'fixed_window' as const,
    message: 'Too many invitations sent. Please try again later.',
  },

  /** API key operations */
  apiKey: {
    maxRequests: 10,
    windowSeconds: 3600, // 1 hour
    algorithm: 'fixed_window' as const,
    message: 'Too many API key operations. Please try again later.',
  },

  /** Session operations */
  session: {
    maxRequests: 30,
    windowSeconds: 60,
    algorithm: 'sliding_window' as const,
  },

  /** Export/download operations */
  export: {
    maxRequests: 10,
    windowSeconds: 3600, // 1 hour
    algorithm: 'fixed_window' as const,
    message: 'Export limit reached. Please try again later.',
  },

  /** Search operations */
  search: {
    maxRequests: 60,
    windowSeconds: 60,
    algorithm: 'sliding_window' as const,
  },

  /** Bulk operations */
  bulk: {
    maxRequests: 5,
    windowSeconds: 60,
    algorithm: 'fixed_window' as const,
    message: 'Too many bulk operations. Please wait before trying again.',
  },
} as const;

// ============================================================================
// In-Memory Storage (Development)
// ============================================================================

interface RateLimitEntry {
  count: number;
  timestamps: number[];
  windowStart: number;
  tokens?: number;
  lastRefill?: number;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

// Cleanup old entries periodically
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      // Remove entries older than 2 hours
      if (now - entry.windowStart > 2 * 60 * 60 * 1000) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// ============================================================================
// Redis Client Interface
// ============================================================================

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcount(key: string, min: number, max: number): Promise<number>;
}

let redisClient: RedisClient | null = null;

/**
 * Initialize Redis client for rate limiting
 */
export function initializeRateLimiter(client: RedisClient): void {
  redisClient = client;
  logger.info({ component: 'RateLimiter' }, 'Redis client initialized');
}

function isRedisAvailable(): boolean {
  return redisClient !== null && process.env.NODE_ENV === 'production';
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Extract client IP from request
 */
export function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  return '127.0.0.1';
}

/**
 * Generate rate limit key based on configuration
 */
function generateKey(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): string | null {
  // Use custom key generator if provided
  if (config.keyGenerator) {
    return config.keyGenerator(request);
  }

  const identifier = config.identifier || 'ip';
  const ip = getClientIP(request);

  // Try to get user ID from session
  // In production, this would come from the actual session
  const userId = request.headers.get('x-user-id');

  switch (identifier) {
    case 'ip':
      return `ratelimit:${endpoint}:ip:${ip}`;

    case 'user':
      if (!userId) return null; // Skip rate limiting if no user
      return `ratelimit:${endpoint}:user:${userId}`;

    case 'ip_and_user':
      if (!userId) {
        return `ratelimit:${endpoint}:ip:${ip}`;
      }
      return `ratelimit:${endpoint}:user:${userId}:ip:${ip}`;

    case 'custom':
      return null; // Must use keyGenerator

    default:
      return `ratelimit:${endpoint}:ip:${ip}`;
  }
}

// ============================================================================
// Rate Limiting Algorithms
// ============================================================================

/**
 * Fixed window rate limiting (in-memory)
 */
function checkFixedWindowMemory(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  let entry = rateLimitStore.get(key);

  // New window or expired
  if (!entry || entry.windowStart !== windowStart) {
    entry = {
      count: 1,
      timestamps: [now],
      windowStart,
    };
    rateLimitStore.set(key, entry);

    return {
      allowed: true,
      current: 1,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetIn: Math.ceil((windowStart + windowMs - now) / 1000),
      resetAt: Math.ceil((windowStart + windowMs) / 1000),
    };
  }

  // Same window
  entry.count++;
  entry.timestamps.push(now);

  const allowed = entry.count <= config.maxRequests;
  const resetIn = Math.ceil((windowStart + windowMs - now) / 1000);
  const resetAt = Math.ceil((windowStart + windowMs) / 1000);

  return {
    allowed,
    current: entry.count,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetIn,
    resetAt,
  };
}

/**
 * Sliding window rate limiting (in-memory)
 */
function checkSlidingWindowMemory(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = now - windowMs;

  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = {
      count: 1,
      timestamps: [now],
      windowStart: now,
    };
    rateLimitStore.set(key, entry);

    return {
      allowed: true,
      current: 1,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      resetIn: config.windowSeconds,
      resetAt: Math.ceil((now + windowMs) / 1000),
    };
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
  entry.timestamps.push(now);
  entry.count = entry.timestamps.length;

  const allowed = entry.count <= config.maxRequests;

  // Calculate reset time (when oldest request falls out of window)
  const oldestTimestamp = entry.timestamps[0] || now;
  const resetIn = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
  const resetAt = Math.ceil((oldestTimestamp + windowMs) / 1000);

  return {
    allowed,
    current: entry.count,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetIn: Math.max(1, resetIn),
    resetAt,
  };
}

/**
 * Token bucket rate limiting (in-memory)
 */
function checkTokenBucketMemory(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const refillRate = config.maxRequests / config.windowSeconds; // tokens per second
  const maxTokens = config.maxRequests;

  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = {
      count: 0,
      timestamps: [],
      windowStart: now,
      tokens: maxTokens - 1, // Use one token
      lastRefill: now,
    };
    rateLimitStore.set(key, entry);

    return {
      allowed: true,
      current: 1,
      limit: maxTokens,
      remaining: maxTokens - 1,
      resetIn: config.windowSeconds,
      resetAt: Math.ceil((now + config.windowSeconds * 1000) / 1000),
    };
  }

  // Refill tokens based on time elapsed
  const elapsedSeconds = (now - (entry.lastRefill || now)) / 1000;
  const tokensToAdd = Math.floor(elapsedSeconds * refillRate);

  if (tokensToAdd > 0) {
    entry.tokens = Math.min(maxTokens, (entry.tokens || 0) + tokensToAdd);
    entry.lastRefill = now;
  }

  // Try to consume a token
  if ((entry.tokens || 0) >= 1) {
    entry.tokens = (entry.tokens || 0) - 1;
    entry.count++;

    return {
      allowed: true,
      current: entry.count,
      limit: maxTokens,
      remaining: Math.floor(entry.tokens || 0),
      resetIn: Math.ceil((maxTokens - (entry.tokens || 0)) / refillRate),
      resetAt: Math.ceil((now + ((maxTokens - (entry.tokens || 0)) / refillRate) * 1000) / 1000),
    };
  }

  // No tokens available
  const timeUntilToken = Math.ceil(1 / refillRate);

  return {
    allowed: false,
    current: entry.count,
    limit: maxTokens,
    remaining: 0,
    resetIn: timeUntilToken,
    resetAt: Math.ceil((now + timeUntilToken * 1000) / 1000),
  };
}

/**
 * Check rate limit using Redis (sliding window)
 */
async function checkSlidingWindowRedis(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (!redisClient) {
    // Fallback to memory
    return checkSlidingWindowMemory(key, config);
  }

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = now - windowMs;

  try {
    // Remove old entries
    await redisClient.zremrangebyscore(key, 0, windowStart);

    // Add current request
    await redisClient.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiry on the key
    await redisClient.expire(key, config.windowSeconds * 2);

    // Count requests in window
    const count = await redisClient.zcount(key, windowStart, now);

    const allowed = count <= config.maxRequests;

    return {
      allowed,
      current: count,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetIn: config.windowSeconds,
      resetAt: Math.ceil((now + windowMs) / 1000),
    };
  } catch (error) {
    console.error('[RateLimiter] Redis error, falling back to memory:', error);
    return checkSlidingWindowMemory(key, config);
  }
}

// ============================================================================
// Main Rate Limiting Function
// ============================================================================

/**
 * Check if a request should be rate limited
 */
export async function checkRateLimit(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // Start cleanup if not running
  startCleanup();

  // Check if should skip
  if (config.skip?.(request)) {
    return {
      allowed: true,
      current: 0,
      limit: config.maxRequests,
      remaining: config.maxRequests,
      resetIn: config.windowSeconds,
      resetAt: Math.ceil((Date.now() + config.windowSeconds * 1000) / 1000),
    };
  }

  // Generate key
  const key = generateKey(request, endpoint, config);
  if (!key) {
    // No key means skip rate limiting
    return {
      allowed: true,
      current: 0,
      limit: config.maxRequests,
      remaining: config.maxRequests,
      resetIn: config.windowSeconds,
      resetAt: Math.ceil((Date.now() + config.windowSeconds * 1000) / 1000),
    };
  }

  const algorithm = config.algorithm || 'sliding_window';

  // Use Redis in production, memory in development
  if (isRedisAvailable()) {
    return checkSlidingWindowRedis(key, config);
  }

  // In-memory implementation based on algorithm
  switch (algorithm) {
    case 'fixed_window':
      return checkFixedWindowMemory(key, config);
    case 'sliding_window':
      return checkSlidingWindowMemory(key, config);
    case 'token_bucket':
      return checkTokenBucketMemory(key, config);
    default:
      return checkSlidingWindowMemory(key, config);
  }
}

/**
 * Check rate limit for a pre-generated key — for callers that already know
 * the identity (e.g. Server Actions loading the session themselves) and do
 * not have a NextRequest to pass through `checkRateLimit`.
 *
 * Throws instead of falling back to memory when `failClosed: true` is set
 * and the Redis client errors. Callers that cannot tolerate silent degrade
 * (e.g. bootstrap token fetch) use that flag to short-circuit.
 */
export async function checkRateLimitByKey(
  key: string,
  config: RateLimitConfig,
  opts?: { failClosed?: boolean },
): Promise<RateLimitResult> {
  startCleanup();

  const algorithm = config.algorithm || 'sliding_window';

  if (isRedisAvailable()) {
    if (opts?.failClosed) {
      // Redis sliding-window path with no memory fallback on error.
      const now = Date.now();
      const windowMs = config.windowSeconds * 1000;
      const windowStart = now - windowMs;
      if (!redisClient) {
        throw new Error('rate limiter redis client unavailable');
      }
      await redisClient.zremrangebyscore(key, 0, windowStart);
      await redisClient.zadd(key, now, `${now}-${Math.random()}`);
      await redisClient.expire(key, config.windowSeconds * 2);
      const count = await redisClient.zcount(key, windowStart, now);
      const allowed = count <= config.maxRequests;
      return {
        allowed,
        current: count,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetIn: config.windowSeconds,
        resetAt: Math.ceil((now + windowMs) / 1000),
      };
    }
    return checkSlidingWindowRedis(key, config);
  }

  switch (algorithm) {
    case 'fixed_window':
      return checkFixedWindowMemory(key, config);
    case 'sliding_window':
      return checkSlidingWindowMemory(key, config);
    case 'token_bucket':
      return checkTokenBucketMemory(key, config);
    default:
      return checkSlidingWindowMemory(key, config);
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Generate rate limit headers
 */
export function getRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toString(),
  };

  if (!result.allowed) {
    headers['Retry-After'] = result.resetIn.toString();
  }

  return headers;
}

/**
 * Create a rate limited response
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  message?: string
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: message || 'Too many requests. Please try again later.',
        retryAfter: result.resetIn,
      },
    },
    {
      status: 429,
      headers: getRateLimitHeaders(result) as Record<string, string>,
    }
  );
}

// ============================================================================
// Middleware Helper
// ============================================================================

/**
 * Rate limiting middleware for API routes
 */
export function withRateLimit(
  endpoint: string,
  config: RateLimitConfig
) {
  return async function rateLimitMiddleware(
    request: NextRequest,
    handler: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    const result = await checkRateLimit(request, endpoint, config);

    if (!result.allowed) {
      return createRateLimitResponse(result, config.message);
    }

    // Execute the handler and add rate limit headers to response
    const response = await handler();

    // Add headers to response
    const headers = getRateLimitHeaders(result);
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) response.headers.set(key, value);
    });

    return response;
  };
}

/**
 * Higher-order function to wrap an API route handler with rate limiting
 */
export function rateLimited(
  endpoint: string,
  config: RateLimitConfig | keyof typeof RATE_LIMIT_PRESETS
) {
  const effectiveConfig = typeof config === 'string'
    ? RATE_LIMIT_PRESETS[config]
    : config;

  return function <T extends (request: NextRequest, ...args: unknown[]) => Promise<NextResponse>>(
    handler: T
  ): T {
    return (async (request: NextRequest, ...args: unknown[]) => {
      const result = await checkRateLimit(request, endpoint, effectiveConfig);

      if (!result.allowed) {
        return createRateLimitResponse(
          result,
          'message' in effectiveConfig ? effectiveConfig.message : undefined
        );
      }

      const response = await handler(request, ...args);

      // Add headers to response
      const headers = getRateLimitHeaders(result);
      Object.entries(headers).forEach(([key, value]) => {
        if (value !== undefined) response.headers.set(key, value);
      });

      return response;
    }) as T;
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear rate limit store (for testing)
 */
export function clearRateLimitStore(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('clearRateLimitStore is not available in production');
  }
  rateLimitStore.clear();
}

/**
 * Get rate limit store size (for testing)
 */
export function getRateLimitStoreSize(): number {
  if (process.env.NODE_ENV === 'production') {
    return -1;
  }
  return rateLimitStore.size;
}

/**
 * Stop cleanup interval (for testing)
 */
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
