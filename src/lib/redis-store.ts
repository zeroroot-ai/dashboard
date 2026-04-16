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

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

let client: RedisClientType | null = null;
let connecting = false;

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

  connecting = true;
  try {
    const c = createClient({ url: redisUrl });
    c.on('error', (err: Error) =>
      console.error('[redis-store] Redis client error:', err.message),
    );
    await c.connect();
    client = c as RedisClientType;
    return client;
  } catch (err) {
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
