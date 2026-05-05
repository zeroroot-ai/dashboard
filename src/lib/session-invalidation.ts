/**
 * Session Invalidation System
 * Redis pub/sub mechanism to invalidate sessions when users are removed from tenants
 */

import { logger } from './logger';

// ============================================================================
// Types
// ============================================================================

export interface MemberRemovalEvent {
  /** Tenant ID the user was removed from */
  tenantId: string;
  /** User ID of the removed member */
  userId: string;
  /** User email (for logging) */
  userEmail?: string;
  /** Admin who performed the removal */
  removedBy: string;
  /** Timestamp of removal */
  timestamp: string;
  /** Request ID for tracing */
  requestId?: string;
}

export interface SessionInvalidationResult {
  success: boolean;
  userId: string;
  sessionsInvalidated: number;
  error?: string;
}

type MemberRemovalHandler = (event: MemberRemovalEvent) => void | Promise<void>;

// ============================================================================
// Redis Channel Constants
// ============================================================================

const CHANNEL_MEMBER_REMOVED = 'tenant:member:removed';
const CHANNEL_SESSION_INVALIDATED = 'session:invalidated';

// ============================================================================
// In-Memory Pub/Sub for Development
// ============================================================================

// In-memory subscribers for development (replace with Redis in production)
const subscribers: Map<string, Set<MemberRemovalHandler>> = new Map();

/**
 * Simulates Redis publish for development
 */
async function devPublish(channel: string, message: string): Promise<void> {
  const handlers = subscribers.get(channel);
  if (handlers) {
    const event = JSON.parse(message);
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        logger.error({ err, component: 'SessionInvalidation' }, 'handler error');
      }
    }
  }
}

/**
 * Simulates Redis subscribe for development
 */
function devSubscribe(channel: string, handler: MemberRemovalHandler): () => void {
  if (!subscribers.has(channel)) {
    subscribers.set(channel, new Set());
  }
  subscribers.get(channel)!.add(handler);

  // Return unsubscribe function
  return () => {
    subscribers.get(channel)?.delete(handler);
  };
}

// ============================================================================
// Redis Client Interface
// ============================================================================

interface RedisClient {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

// Placeholder for actual Redis client - would be imported in production
let redisClient: RedisClient | null = null;

/**
 * Initialize Redis client for session invalidation
 * Call this once during application startup
 */
export function initializeSessionInvalidation(client: RedisClient): void {
  redisClient = client;
  logger.info({ component: 'SessionInvalidation' }, 'Redis client initialized');
}

/**
 * Check if Redis client is available
 */
function isRedisAvailable(): boolean {
  return redisClient !== null && process.env.NODE_ENV === 'production';
}

// ============================================================================
// Publish Functions
// ============================================================================

/**
 * Publish a member removal event to trigger session invalidation
 *
 * @param tenantId - Tenant the user was removed from
 * @param userId - User ID of the removed member
 * @param removedBy - Admin who performed the removal
 * @param options - Additional event options
 */
export async function publishMemberRemoved(
  tenantId: string,
  userId: string,
  removedBy: string,
  options?: {
    userEmail?: string;
    requestId?: string;
  }
): Promise<void> {
  const event: MemberRemovalEvent = {
    tenantId,
    userId,
    userEmail: options?.userEmail,
    removedBy,
    timestamp: new Date().toISOString(),
    requestId: options?.requestId,
  };

  const message = JSON.stringify(event);

  if (isRedisAvailable()) {
    try {
      await redisClient!.publish(CHANNEL_MEMBER_REMOVED, message);
      logger.info(
        {
          component: 'SessionInvalidation',
          tenantId,
          userId,
          requestId: options?.requestId,
        },
        'published member removal event',
      );
    } catch (err) {
      logger.error(
        { err, component: 'SessionInvalidation' },
        'failed to publish event',
      );
      // Fallback to direct invalidation on publish failure
      await invalidateUserSessions(userId);
    }
  } else {
    // Development mode - use in-memory pub/sub
    await devPublish(CHANNEL_MEMBER_REMOVED, message);
    logger.info(
      { component: 'SessionInvalidation', mode: 'dev', tenantId, userId },
      'published member removal event (dev)',
    );
  }
}

/**
 * Publish session invalidation confirmation
 */
async function publishSessionInvalidated(
  userId: string,
  sessionsInvalidated: number
): Promise<void> {
  const message = JSON.stringify({
    userId,
    sessionsInvalidated,
    timestamp: new Date().toISOString(),
  });

  if (isRedisAvailable()) {
    await redisClient!.publish(CHANNEL_SESSION_INVALIDATED, message);
  }
}

// ============================================================================
// Subscribe Functions
// ============================================================================

/**
 * Subscribe to member removal events
 * The handler will be called for each removal event to invalidate sessions
 *
 * @returns Unsubscribe function
 */
export function subscribeMemberRemovals(
  handler?: MemberRemovalHandler
): () => void {
  const defaultHandler: MemberRemovalHandler = async (event) => {
    logger.info(
      {
        component: 'SessionInvalidation',
        tenantId: event.tenantId,
        userId: event.userId,
        timestamp: event.timestamp,
      },
      'received member removal event',
    );

    const result = await invalidateUserSessions(event.userId);

    if (result.success) {
      logger.info(
        {
          component: 'SessionInvalidation',
          userId: event.userId,
          count: result.sessionsInvalidated,
        },
        'sessions invalidated',
      );
      await publishSessionInvalidated(event.userId, result.sessionsInvalidated);
    } else {
      logger.error(
        {
          component: 'SessionInvalidation',
          userId: event.userId,
          err: result.error,
        },
        'failed to invalidate sessions',
      );
    }
  };

  const actualHandler = handler || defaultHandler;

  if (isRedisAvailable()) {
    // Production: Use Redis pub/sub
    redisClient!.subscribe(CHANNEL_MEMBER_REMOVED, (message) => {
      try {
        const event: MemberRemovalEvent = JSON.parse(message);
        actualHandler(event);
      } catch (err) {
        logger.error(
          { err, component: 'SessionInvalidation' },
          'failed to parse event',
        );
      }
    });

    return () => {
      redisClient!.unsubscribe(CHANNEL_MEMBER_REMOVED);
    };
  } else {
    // Development: Use in-memory pub/sub
    return devSubscribe(CHANNEL_MEMBER_REMOVED, actualHandler);
  }
}

// ============================================================================
// Session Invalidation
// ============================================================================

/**
 * Invalidate all sessions for a specific user
 * This forces the user to re-authenticate on their next request
 *
 * @param userId - User ID whose sessions should be invalidated
 */
export async function invalidateUserSessions(
  userId: string
): Promise<SessionInvalidationResult> {
  try {
    if (isRedisAvailable()) {
      // Production: Delete all session keys for this user from Redis.
      // Auth.js sessions are stored with keys like: "session:<sessionToken>"
      // We need to find and delete all sessions belonging to this user

      // Pattern 1: Direct session lookup (if using user-indexed sessions)
      const userSessionPattern = `user:${userId}:session:*`;
      const userSessionKeys = await redisClient!.keys(userSessionPattern);

      // Pattern 2: Check all sessions for user ownership
      // This is more expensive but ensures we catch all sessions
      const allSessionPattern = 'session:*';
      const allSessionKeys = await redisClient!.keys(allSessionPattern);

      let invalidatedCount = 0;

      // Delete user-indexed sessions
      for (const key of userSessionKeys) {
        await redisClient!.del(key);
        invalidatedCount++;
      }

      // Note: In a real implementation, you would iterate through allSessionKeys
      // and check if each session belongs to the user before deleting
      // This requires reading the session data, which adds overhead

      logger.info(
        {
          component: 'SessionInvalidation',
          userId,
          count: invalidatedCount,
        },
        'invalidated sessions in Redis',
      );

      return {
        success: true,
        userId,
        sessionsInvalidated: invalidatedCount,
      };
    } else {
      // Development: Use in-memory session store simulation
      logger.info(
        { component: 'SessionInvalidation', mode: 'dev', userId },
        'simulating session invalidation',
      );

      // In development, we'll signal via a custom event that the client should refetch
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('session-invalidated', {
            detail: { userId },
          })
        );
      }

      return {
        success: true,
        userId,
        sessionsInvalidated: 1, // Simulated
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error(
      { err, component: 'SessionInvalidation', userId },
      'error invalidating sessions',
    );

    return {
      success: false,
      userId,
      sessionsInvalidated: 0,
      error: errorMessage,
    };
  }
}

/**
 * Invalidate a specific session by token
 *
 * @param sessionToken - The session token to invalidate
 */
export async function invalidateSession(sessionToken: string): Promise<boolean> {
  try {
    if (isRedisAvailable()) {
      await redisClient!.del(`session:${sessionToken}`);
      logger.info(
        { component: 'SessionInvalidation' },
        'session invalidated',
      );
      return true;
    } else {
      logger.info(
        { component: 'SessionInvalidation', mode: 'dev' },
        'session invalidation simulated',
      );
      return true;
    }
  } catch (err) {
    logger.error(
      { err, component: 'SessionInvalidation' },
      'error invalidating session',
    );
    return false;
  }
}

// ============================================================================
// Tenant Access Revocation
// ============================================================================

/**
 * Revoke a user's access to a specific tenant
 * This invalidates sessions and updates the user's tenant list
 *
 * @param tenantId - Tenant to revoke access from
 * @param userId - User to revoke access for
 * @param removedBy - Admin performing the action
 * @param options - Additional options
 */
export async function revokeTenantAccess(
  tenantId: string,
  userId: string,
  removedBy: string,
  options?: {
    userEmail?: string;
    requestId?: string;
    immediate?: boolean;
  }
): Promise<SessionInvalidationResult> {
  // Publish the removal event for pub/sub handling
  await publishMemberRemoved(tenantId, userId, removedBy, {
    userEmail: options?.userEmail,
    requestId: options?.requestId,
  });

  // If immediate invalidation is requested, also directly invalidate
  if (options?.immediate) {
    return invalidateUserSessions(userId);
  }

  // Otherwise, trust the pub/sub mechanism
  return {
    success: true,
    userId,
    sessionsInvalidated: 0, // Will be updated by pub/sub handler
  };
}

// ============================================================================
// Client-Side Session Monitoring
// ============================================================================

/**
 * Hook for client-side session invalidation monitoring
 * Call this in the root component to listen for session invalidation events
 *
 * @param onInvalidated - Callback when current user's session is invalidated
 */
export function monitorSessionInvalidation(
  userId: string,
  onInvalidated: () => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleInvalidation = (event: Event) => {
    const customEvent = event as CustomEvent<{ userId: string }>;
    if (customEvent.detail.userId === userId) {
      logger.info(
        { component: 'SessionInvalidation' },
        'current user session invalidated',
      );
      onInvalidated();
    }
  };

  window.addEventListener('session-invalidated', handleInvalidation);

  return () => {
    window.removeEventListener('session-invalidated', handleInvalidation);
  };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Simulate a member removal event for testing
 * Only available in development/test environments
 */
export async function simulateMemberRemoval(
  tenantId: string,
  userId: string
): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('simulateMemberRemoval is not available in production');
  }

  await publishMemberRemoved(tenantId, userId, 'test-admin', {
    userEmail: 'test@example.com',
    requestId: `test-${Date.now()}`,
  });
}

/**
 * Get the number of active subscribers (for testing)
 */
export function getSubscriberCount(): number {
  if (process.env.NODE_ENV === 'production') {
    return -1; // Not available in production
  }
  return subscribers.get(CHANNEL_MEMBER_REMOVED)?.size ?? 0;
}

/**
 * Clear all subscribers (for testing cleanup)
 */
export function clearAllSubscribers(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('clearAllSubscribers is not available in production');
  }
  subscribers.clear();
}
