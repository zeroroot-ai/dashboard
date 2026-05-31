/**
 * Shared Redis client for server-side key/value persistence.
 *
 * Used by API routes that previously relied on in-memory Maps
 * (onboarding state, user layout, etc.).
 *
 * If Redis is unavailable the helpers return `null` so callers
 * can fall back to sensible defaults with a warning log.
 */

import { createClient, type RedisClientType } from 'redis';

const redisUrl = process.env.REDIS_URL;

// Server Actions hit redis-store on the critical path (signin lockout
// counters, etc.). A hung Redis connection would block the whole UI with
// "Please wait…" — cap the connect attempt at 2 seconds so the caller gets
// a null back and can fall through to the in-memory path.
const CONNECT_TIMEOUT_MS = 2000;
// After a hard failure, refuse to re-attempt for this window. Keeps retry
// storms from pinning the event loop when Redis is down for a while.
const RECONNECT_COOLDOWN_MS = 10_000;

let client: RedisClientType | null = null;
let connecting = false;
let lastFailureAt = 0;

/**
 * Return a connected Redis client, or `null` if connection fails.
 *
 * The client is lazily created on first call and reused for the
 * lifetime of the process. Connection errors are logged but never
 * thrown so callers degrade gracefully.
 */
async function getRedis(): Promise<RedisClientType | null> {
  if (client) return client;

  // Prevent multiple concurrent connection attempts during startup.
  if (connecting) return null;

  // Cooldown: don't retry for RECONNECT_COOLDOWN_MS after a failure.
  if (lastFailureAt && Date.now() - lastFailureAt < RECONNECT_COOLDOWN_MS) {
    return null;
  }

  connecting = true;
  try {
    const c = createClient({
      url: redisUrl,
      socket: {
        // Fail fast on initial connect. Without this, the redis client
        // retries internally with exponential backoff and the first caller
        // can wait 30s+ before getting an error.
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Disable infinite reconnection loop — one attempt, then error.
        reconnectStrategy: false,
      },
    });
    c.on('error', (err: Error) =>
      console.error('[redis-store] Redis client error:', err.message),
    );
    // Race the connect() against a hard timeout so a black-holed socket
    // cannot hang the event loop.
    await Promise.race([
      c.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);
    lastFailureAt = 0;
    client = c as RedisClientType;
    return client;
  } catch (err) {
    lastFailureAt = Date.now();
    console.error(
      '[redis-store] Failed to connect to Redis:',
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    connecting = false;
  }
}

// ============================================================================
// Public helpers
// ============================================================================

/**
 * Retrieve a JSON-serialised value from Redis.
 *
 * Returns `null` when the key does not exist **or** when Redis is
 * unreachable (a warning is logged in the latter case).
 */
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    if (!redis) {
      console.warn('[redis-store] Redis unavailable; returning null for key:', key);
      return null;
    }
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(
      '[redis-store] Error reading key',
      key,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Store a value as JSON in Redis with an optional TTL (seconds).
 *
 * Returns `true` on success. Returns `false` (with a warning log)
 * when Redis is unreachable.
 */
export async function setJSON(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) {
      console.warn('[redis-store] Redis unavailable; cannot write key:', key);
      return false;
    }
    const serialized = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.setEx(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
    return true;
  } catch (err) {
    console.warn(
      '[redis-store] Error writing key',
      key,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Delete a key from Redis.
 *
 * Returns `true` on success or when the key did not exist.
 * Returns `false` (with a warning log) when Redis is unreachable.
 */
export async function delKey(key: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) {
      console.warn('[redis-store] Redis unavailable; cannot delete key:', key);
      return false;
    }
    await redis.del(key);
    return true;
  } catch (err) {
    console.warn(
      '[redis-store] Error deleting key',
      key,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Prepend a string value to a Redis list, trim it to `maxLen` entries,
 * and (re)set its TTL. Silently no-ops when Redis is unavailable.
 */
export async function listPrepend(
  key: string,
  value: string,
  maxLen: number,
  ttlSeconds: number,
): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.lPush(key, value);
    await redis.lTrim(key, 0, maxLen - 1);
    await redis.expire(key, ttlSeconds);
  } catch (err) {
    console.warn('[redis-store] Error in listPrepend for key', key, err instanceof Error ? err.message : err);
  }
}

/**
 * Retrieve all string entries from a Redis list (up to `limit`).
 * Returns an empty array when the key does not exist or Redis is unavailable.
 */
export async function listGetAll(key: string, limit = 100): Promise<string[]> {
  try {
    const redis = await getRedis();
    if (!redis) return [];
    return await redis.lRange(key, 0, limit - 1);
  } catch (err) {
    console.warn('[redis-store] Error in listGetAll for key', key, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Store a plain string in Redis with a TTL. Silently no-ops when Redis is unavailable.
 */
export async function setStr(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.setEx(key, ttlSeconds, value);
  } catch (err) {
    console.warn('[redis-store] Error in setStr for key', key, err instanceof Error ? err.message : err);
  }
}

/**
 * Retrieve a plain string from Redis.
 * Returns `null` when the key does not exist or Redis is unavailable.
 */
export async function getStr(key: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    return await redis.get(key);
  } catch (err) {
    console.warn('[redis-store] Error in getStr for key', key, err instanceof Error ? err.message : err);
    return null;
  }
}
// ============================================================================
// Conversation persistence — spec: chat-conversation-persistence (dashboard#446)
// ============================================================================

export interface ConversationMessagePayload {
  id: string;
  role: string;
  content: string;
  created_at_unix?: number;
}

/**
 * Update only the `title` field of an existing conversation hash.
 *
 * Used by the auto-title server action so the full message payload is not
 * re-serialised on every title update. Returns `true` on success, `false`
 * when Redis is unavailable or the key does not exist.
 */
export async function updateConversationTitle(
  tenantId: string,
  conversationId: string,
  title: string,
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) {
      console.warn(
        '[redis-store] Redis unavailable; cannot update title for conversation:',
        conversationId,
      );
      return false;
    }
    const hashKey = `conv:${tenantId}:${conversationId}`;
    // Only update if the hash exists — hSetField on a missing key would
    // silently create a partial record.
    const exists = await redis.exists(hashKey);
    if (!exists) return false;
    const now = new Date().toISOString();
    await redis.hSet(hashKey, { title, updated_at: now });
    return true;
  } catch (err) {
    console.warn(
      '[redis-store] Error updating title for conversation',
      conversationId,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

