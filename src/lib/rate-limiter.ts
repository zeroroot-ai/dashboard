/**
 * Rate Limiting System
 *
 * Rate limiting for API routes and Server Actions. Because signup CAPTCHA is a
 * deliberate WONTFIX, rate limiting is the ONLY abuse control on the public
 * surface, so the invariants below are load-bearing rather than best-effort:
 *
 *  1. The identity a limit is keyed on must NOT be attacker-controlled.
 *     A limit keyed on a spoofable value is not a limit: the attacker rotates
 *     the value to get unlimited budget, and pins it to a victim's value to
 *     exhaust *their* budget. See `resolveClientIp`.
 *
 *  2. Budget is consumed ONLY by requests that are inside it, and only once.
 *     A limiter that records refused attempts lets a blocked source keep its
 *     own bucket permanently full: every rejection re-arms the window, so the
 *     bucket never drains and the source is locked out forever. Combined with
 *     (1) that turns into a lockout primitive against any chosen victim.
 *
 *  3. Unrelated sources never share a bucket. Keys are namespaced per
 *     endpoint and per resolved identity.
 *
 * Storage: the dashboard is a thin client and holds no backing-store
 * credentials, it may not import a Redis/Postgres driver directly
 * (dashboard#584, enforced by scripts/check-no-store-clients.mjs). This module
 * therefore does not construct a shared store, it only accepts one via
 * `initializeRateLimiter`. Until a composition root injects one, limits are
 * enforced per-process, which multiplies the effective limit by the replica
 * count. That degradation is logged loudly rather than assumed away.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

// ============================================================================
// Types
// ============================================================================

type RateLimitAlgorithm = 'fixed_window' | 'sliding_window';

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

interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests recorded in the window, including this one if allowed */
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

interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Shared store (injected, never constructed here)
// ============================================================================

/**
 * Verdict returned by a shared, cross-process rate-limit store.
 *
 * @public Part of the injection seam below. Deliberately has no in-repo
 * implementer yet: where the shared counter lives (a daemon RPC vs an
 * exception to the thin-client rule) is an open owner decision, and the
 * contract is published here so whichever wins can satisfy it without
 * reshaping this module.
 */
export interface RateLimitStoreVerdict {
  allowed: boolean;
  /** Requests recorded in the window after this call. */
  current: number;
  /** Seconds until the bucket has room again. */
  resetInSeconds: number;
}

/**
 * Contract for a shared (cross-pod) rate-limit store.
 *
 * `consume` MUST be atomic and MUST be consume-on-success: it may record the
 * attempt only when the attempt is inside the budget. An implementation that
 * records refused attempts violates invariant (2) above and is not a valid
 * store for this interface.
 *
 * @public Injection seam — see RateLimitStoreVerdict for why it currently has
 * no in-repo implementer.
 */
export interface RateLimitStore {
  consume(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitStoreVerdict>;
}

let sharedStore: RateLimitStore | null = null;
let missingStoreLogged = false;

/**
 * Inject the shared rate-limit store.
 *
 * Call this once from a server composition root (or from a test). Passing
 * `null` reverts to the per-process in-memory map.
 */
export function initializeRateLimiter(store: RateLimitStore | null): void {
  sharedStore = store;
  missingStoreLogged = false;
  logger.info(
    { component: 'RateLimiter', shared: store !== null },
    store !== null
      ? 'shared rate-limit store installed'
      : 'shared rate-limit store cleared, limits are per-process',
  );
}

/**
 * Resolve the store to use, logging once when there is none.
 *
 * The absence of a shared store is a real weakening of the control (the
 * effective limit becomes `configured limit x replica count`), so it is
 * reported at error level rather than silently tolerated.
 */
function getStore(): RateLimitStore | null {
  if (sharedStore) return sharedStore;
  if (!missingStoreLogged) {
    missingStoreLogged = true;
    logger.error(
      { component: 'RateLimiter' },
      'no shared rate-limit store is installed: limits are enforced per-process, ' +
        'so the effective limit is multiplied by the replica count. Inject one via ' +
        'initializeRateLimiter() to restore a cluster-wide limit.',
    );
  }
  return null;
}

// ============================================================================
// In-process storage (fallback)
// ============================================================================

interface RateLimitEntry {
  /** Timestamps of ACCEPTED requests only. Refused attempts are never recorded. */
  timestamps: number[];
  /** Start of the fixed window this entry belongs to (fixed_window only). */
  windowStart: number;
  /** Last time this entry was touched, used for eviction. */
  lastSeen: number;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

const CLEANUP_INTERVAL_MS = 60 * 1000;
const ENTRY_TTL_MS = 2 * 60 * 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.lastSeen > ENTRY_TTL_MS) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Never hold the process open for the sweeper.
  cleanupInterval.unref?.();
}

/** Clear the in-process store. Exported for tests. */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

// ============================================================================
// Client identity
// ============================================================================

/**
 * How many reverse proxies we operate between the public internet and this
 * process. The dashboard runs behind exactly one (Envoy), which is the
 * default; override only when the topology genuinely changes (e.g. a CDN is
 * placed in front of Envoy, making it two).
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * Bucket used when the source cannot be established, i.e. the request did not
 * arrive through the trusted proxy chain. In production nothing reaches the
 * pod except via Envoy, so this bucket should stay empty; sharing it is
 * deliberate, an unidentifiable source gets no per-source budget.
 */
const UNIDENTIFIED_SOURCE = 'unidentified';

function trustedProxyHopCount(): number {
  const raw = process.env.TRUSTED_PROXY_HOP_COUNT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(
      { component: 'RateLimiter', value: raw },
      'TRUSTED_PROXY_HOP_COUNT is not a non-negative integer, using the default',
    );
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  return parsed;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Validate and normalise a single X-Forwarded-For entry.
 *
 * Returns null for anything that is not a plausible IP address, so a garbage
 * entry can never become a rate-limit bucket name.
 */
function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (value === '') return null;

  // `[2001:db8::1]:443` -> `2001:db8::1`
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return null;
    value = value.slice(1, close);
  } else {
    // `1.2.3.4:443` -> `1.2.3.4` (a bare IPv6 has >1 colon and no port here)
    const colons = value.split(':').length - 1;
    if (colons === 1) value = value.slice(0, value.indexOf(':'));
  }

  const v4 = IPV4.exec(value);
  if (v4) {
    for (let i = 1; i <= 4; i += 1) {
      const octet = Number(v4[i]);
      if (octet > 255) return null;
    }
    return value;
  }

  // Loose IPv6 check: hex groups and colons only, at least two colons.
  if (/^[0-9a-fA-F:]+$/.test(value) && value.includes('::')) return value.toLowerCase();
  if (/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(value)) return value.toLowerCase();

  return null;
}

/**
 * Resolve the client IP from a request's headers.
 *
 * X-Forwarded-For grows left-to-right: each proxy APPENDS the address of the
 * peer it received the request from. So with `hops` proxies that we operate,
 * the right-hand `hops` entries were written by our own infrastructure and the
 * entry at `length - hops` is the address our outermost trusted proxy actually
 * observed. Everything to the left of that was supplied by the caller and is
 * forgeable.
 *
 * Reading the LEFTMOST entry, as this function previously did, means reading a
 * value the attacker writes: they rotate it for unlimited budget, or pin it to
 * a victim's IP to exhaust the victim's budget.
 *
 * Exported for tests.
 */
export function resolveClientIp(
  headers: Pick<Headers, 'get'>,
  hops: number = trustedProxyHopCount(),
): string {
  const forwardedFor = headers.get('x-forwarded-for');

  if (forwardedFor) {
    const entries = forwardedFor
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');

    if (entries.length > 0) {
      // With 0 trusted hops there is no proxy to have appended anything, so
      // the whole header is caller-supplied and worthless; fall through.
      if (hops > 0) {
        // Clamp: a chain shorter than the configured hop count means the
        // request did not traverse the full expected path. Index 0 is then
        // the best available value and is still proxy-written.
        const index = Math.max(0, entries.length - hops);
        const ip = normalizeIp(entries[index]);
        return ip ?? UNIDENTIFIED_SOURCE;
      }
    }
  }

  // x-real-ip is set by proxies but is equally forgeable by a direct caller,
  // so it is only honoured when we are NOT behind a proxy at all (hops === 0),
  // i.e. a local `next dev` run.
  if (hops === 0) {
    const realIp = headers.get('x-real-ip');
    if (realIp) {
      const ip = normalizeIp(realIp);
      if (ip) return ip;
    }
  }

  return UNIDENTIFIED_SOURCE;
}

/**
 * Generate the rate limit key.
 *
 * Note on `identifier: 'user'`: the user id is NOT read from a request header.
 * A client-supplied `x-user-id` was previously trusted here, which let a caller
 * mint a fresh bucket per request (unlimited budget) or omit the header
 * entirely to get no rate limiting at all. Until a trusted server-side identity
 * is threaded in, user-keyed configs degrade to IP-keyed limiting, which is
 * strictly stronger than the previous behaviour.
 *
 * Returns null ONLY for `custom` + `keyGenerator` that opts out explicitly.
 */
function generateKey(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig,
): string | null {
  if (config.keyGenerator) {
    return config.keyGenerator(request);
  }

  const ip = resolveClientIp(request.headers);
  return `ratelimit:${endpoint}:ip:${ip}`;
}

// ============================================================================
// Algorithms (in-process)
// ============================================================================

function touch(key: string, now: number, windowStart: number): RateLimitEntry {
  const existing = rateLimitStore.get(key);
  if (existing) {
    existing.lastSeen = now;
    return existing;
  }
  const created: RateLimitEntry = { timestamps: [], windowStart, lastSeen: now };
  rateLimitStore.set(key, created);
  return created;
}

/**
 * Fixed window, consume-on-success.
 */
function checkFixedWindowMemory(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAtMs = windowStart + windowMs;

  const entry = touch(key, now, windowStart);
  if (entry.windowStart !== windowStart) {
    entry.windowStart = windowStart;
    entry.timestamps = [];
  }

  const resetIn = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  const resetAt = Math.ceil(resetAtMs / 1000);

  if (entry.timestamps.length >= config.maxRequests) {
    // Refused: do NOT record. See invariant (2).
    return {
      allowed: false,
      current: entry.timestamps.length,
      limit: config.maxRequests,
      remaining: 0,
      resetIn,
      resetAt,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    current: entry.timestamps.length,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.timestamps.length),
    resetIn,
    resetAt,
  };
}

/**
 * Sliding window, consume-on-success.
 */
function checkSlidingWindowMemory(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;

  const entry = touch(key, now, now);
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

  if (entry.timestamps.length >= config.maxRequests) {
    // Refused: do NOT record. Recording here would push the oldest timestamp
    // forward on every rejection, so the window would never drain.
    const oldest = entry.timestamps[0] ?? now;
    const resetInMs = oldest + windowMs - now;
    return {
      allowed: false,
      current: entry.timestamps.length,
      limit: config.maxRequests,
      remaining: 0,
      resetIn: Math.max(1, Math.ceil(resetInMs / 1000)),
      resetAt: Math.ceil((oldest + windowMs) / 1000),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    current: entry.timestamps.length,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.timestamps.length),
    resetIn: config.windowSeconds,
    resetAt: Math.ceil((now + windowMs) / 1000),
  };
}

function checkMemory(key: string, config: RateLimitConfig): RateLimitResult {
  return (config.algorithm ?? 'sliding_window') === 'fixed_window'
    ? checkFixedWindowMemory(key, config)
    : checkSlidingWindowMemory(key, config);
}

function verdictToResult(
  verdict: RateLimitStoreVerdict,
  config: RateLimitConfig,
): RateLimitResult {
  const resetIn = Math.max(1, Math.ceil(verdict.resetInSeconds));
  return {
    allowed: verdict.allowed,
    current: verdict.current,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - verdict.current),
    resetIn,
    resetAt: Math.ceil(Date.now() / 1000) + resetIn,
  };
}

/**
 * Consume one unit from `key`, preferring the shared store.
 *
 * `failClosed` governs what happens when the shared store ERRORS: callers that
 * cannot tolerate a silent downgrade (e.g. bootstrap-token enumeration) get
 * the error rethrown instead of a per-process fallback.
 */
async function consume(
  key: string,
  config: RateLimitConfig,
  failClosed: boolean,
): Promise<RateLimitResult> {
  startCleanup();

  const store = getStore();
  if (!store) {
    return checkMemory(key, config);
  }

  try {
    const verdict = await store.consume(key, config.maxRequests, config.windowSeconds);
    return verdictToResult(verdict, config);
  } catch (err) {
    if (failClosed) throw err;
    logger.warn(
      { component: 'RateLimiter', err },
      'shared rate-limit store failed, falling back to the per-process limit',
    );
    return checkMemory(key, config);
  }
}

// ============================================================================
// Public API
// ============================================================================

function unlimited(config: RateLimitConfig): RateLimitResult {
  return {
    allowed: true,
    current: 0,
    limit: config.maxRequests,
    remaining: config.maxRequests,
    resetIn: config.windowSeconds,
    resetAt: Math.ceil((Date.now() + config.windowSeconds * 1000) / 1000),
  };
}

/**
 * Check (and consume) the rate limit for an incoming request.
 */
export async function checkRateLimit(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (config.skip?.(request)) {
    return unlimited(config);
  }

  const key = generateKey(request, endpoint, config);
  if (!key) {
    return unlimited(config);
  }

  return consume(key, config, false);
}

/**
 * Check (and consume) the rate limit for a pre-generated key, for callers that
 * already know the identity (e.g. Server Actions loading the session
 * themselves) and have no NextRequest to pass through `checkRateLimit`.
 *
 * With `failClosed: true` a shared-store error is rethrown instead of silently
 * degrading to the per-process limit.
 */
export async function checkRateLimitByKey(
  key: string,
  config: RateLimitConfig,
  opts?: { failClosed?: boolean },
): Promise<RateLimitResult> {
  return consume(key, config, opts?.failClosed === true);
}

// ============================================================================
// Response helpers
// ============================================================================

function getRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
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
 * Create a 429 response carrying the standard rate-limit headers.
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  message?: string,
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
    },
  );
}
