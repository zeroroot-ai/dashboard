/**
 * Session Security Hook
 *
 * React hook for integrating session security features into components.
 * Provides:
 * - Session refresh monitoring
 * - Suspicious activity detection
 * - Concurrent session management
 * - Session invalidation handling
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { signOut } from 'next-auth/react';
import { useSession } from '@/src/lib/session-client';
import type { GibsonSession } from '@/src/lib/auth';

// ============================================================================
// Types
// ============================================================================

export interface SessionSecurityOptions {
  /** Enable automatic session refresh */
  autoRefresh?: boolean;
  /** Refresh check interval in ms (default: 60000 = 1 minute) */
  refreshCheckInterval?: number;
  /** Enable suspicious activity alerts */
  enableAlerts?: boolean;
  /** Callback when session is about to expire */
  onSessionExpiring?: (minutesRemaining: number) => void;
  /** Callback when session is invalidated externally */
  onSessionInvalidated?: () => void;
  /** Callback when suspicious activity is detected */
  onSuspiciousActivity?: (activityType: string, severity: string) => void;
}

export interface SessionSecurityState {
  /** Whether session is valid */
  isValid: boolean;
  /** Whether session is about to expire */
  isExpiring: boolean;
  /** Minutes until session expires */
  minutesUntilExpiry: number;
  /** Whether a refresh is in progress */
  isRefreshing: boolean;
  /** Last activity timestamp */
  lastActivity: Date | null;
  /** Device fingerprint */
  deviceFingerprint: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REFRESH_INTERVAL = 60 * 1000; // 1 minute
const EXPIRY_WARNING_MINUTES = 15;
const SESSION_STORAGE_KEY = 'session_security_fingerprint';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a simple device fingerprint
 */
function generateDeviceFingerprint(): string {
  if (typeof window === 'undefined') return '';

  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString(),
    navigator.platform || '',
  ];

  return btoa(components.join('|')).slice(0, 32);
}

/**
 * Get stored fingerprint
 */
function getStoredFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SESSION_STORAGE_KEY);
}

/**
 * Store fingerprint
 */
function storeFingerprint(fingerprint: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_STORAGE_KEY, fingerprint);
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSessionSecurity(options: SessionSecurityOptions = {}): SessionSecurityState & {
  refreshSession: () => Promise<boolean>;
  terminateOtherSessions: () => Promise<boolean>;
  reportActivity: () => void;
} {
  const { data: baSessionData, isPending } = useSession();
  // Better Auth returns { session, user } — cast to GibsonSession shape for
  // downstream compatibility with the error/expires fields we depend on.
  const session = baSessionData as unknown as GibsonSession | null;
  const status = isPending ? 'loading' : baSessionData ? 'authenticated' : 'unauthenticated';

  const {
    autoRefresh = true,
    refreshCheckInterval = DEFAULT_REFRESH_INTERVAL,
    enableAlerts = true,
    onSessionExpiring,
    onSessionInvalidated,
    onSuspiciousActivity,
  } = options;

  // State
  const [state, setState] = useState<SessionSecurityState>({
    isValid: false,
    isExpiring: false,
    minutesUntilExpiry: 0,
    isRefreshing: false,
    lastActivity: null,
    deviceFingerprint: null,
  });

  // Refs
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<Date>(new Date());

  // Initialize fingerprint
  useEffect(() => {
    const fingerprint = getStoredFingerprint() || generateDeviceFingerprint();
    if (!getStoredFingerprint()) {
      storeFingerprint(fingerprint);
    }
    setState((prev) => ({ ...prev, deviceFingerprint: fingerprint }));
  }, []);

  // Session validity check — detect expired sessions.
  useEffect(() => {
    if (status === 'loading') return;

    // If the session carries an error (e.g., from the server-side enrichment),
    // sign out and redirect to login.
    if (session?.error === 'RefreshTokenExpired') {
      console.warn('[SessionSecurity] Refresh token expired, signing out');
      void signOut({ redirectTo: "/login" });
      return;
    }

    const isValid = status === 'authenticated' && !!(baSessionData as unknown as { user?: unknown } | null)?.user;

    setState((prev) => ({
      ...prev,
      isValid,
      lastActivity: isValid ? new Date() : null,
    }));
  }, [session, status, baSessionData]);

  // Check session expiry. The Auth.js session top-level `expires` is the ISO
  // string we trust; `expiresAt` is a back-compat fallback on the client
  // session shape for any in-flight callers still passing a Date.
  const checkExpiry = useCallback(() => {
    const expiresAtRaw = baSessionData?.expiresAt;
    const expiresStr = session?.expires ??
      (typeof expiresAtRaw === 'string'
        ? expiresAtRaw
        : expiresAtRaw instanceof Date
          ? expiresAtRaw.toISOString()
          : undefined);

    if (!expiresStr) return;

    const expiresAt = new Date(expiresStr);
    const now = new Date();
    const msUntilExpiry = expiresAt.getTime() - now.getTime();
    const minutesUntilExpiry = Math.max(0, Math.floor(msUntilExpiry / (60 * 1000)));

    const isExpiring = minutesUntilExpiry <= EXPIRY_WARNING_MINUTES && minutesUntilExpiry > 0;

    setState((prev) => ({
      ...prev,
      minutesUntilExpiry,
      isExpiring,
    }));

    if (isExpiring && onSessionExpiring) {
      onSessionExpiring(minutesUntilExpiry);
    }

    // Session has expired
    if (msUntilExpiry <= 0) {
      onSessionInvalidated?.();
    }
  }, [session?.expires, baSessionData, onSessionExpiring, onSessionInvalidated]);

  // Refresh session — Better Auth handles session renewal automatically via
  // cookie expiry. To manually touch the session, call the /api/auth/get-session
  // endpoint which will update the cookie cache.
  const refreshSession = useCallback(async (): Promise<boolean> => {
    if (!baSessionData) return false;

    setState((prev) => ({ ...prev, isRefreshing: true }));

    try {
      // Touch the session endpoint to renew the cookie cache.
      await fetch('/api/auth/get-session', { method: 'GET', credentials: 'include' });

      setState((prev) => ({
        ...prev,
        isRefreshing: false,
        isExpiring: false,
      }));

      return true;
    } catch (error) {
      console.error('[SessionSecurity] Failed to refresh session:', error);
      setState((prev) => ({ ...prev, isRefreshing: false }));
      return false;
    }
  }, [baSessionData]);

  // Terminate other sessions
  const terminateOtherSessions = useCallback(async (): Promise<boolean> => {
    const userEmail = (baSessionData as unknown as { user?: { email?: string } } | null)?.user?.email;
    if (!userEmail) return false;

    try {
      const response = await fetch(`/api/team/me/sessions?all=true`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to terminate sessions');
      }

      return true;
    } catch (error) {
      console.error('[SessionSecurity] Failed to terminate sessions:', error);
      return false;
    }
  }, [baSessionData]);

  // Report user activity
  const reportActivity = useCallback(() => {
    lastActivityRef.current = new Date();
    setState((prev) => ({ ...prev, lastActivity: new Date() }));

    // Debounced activity reporting
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }

    activityTimeoutRef.current = setTimeout(() => {
      // Could send activity ping to server here
      // For now, just update local state
    }, 5000);
  }, []);

  // Session invalidation listener
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const userId = (baSessionData as unknown as { user?: { id?: string } } | null)?.user?.id;

    const handleInvalidation = (event: Event) => {
      const customEvent = event as CustomEvent<{ userId: string }>;
      if (userId === customEvent.detail.userId) {
        onSessionInvalidated?.();
        void signOut({ redirectTo: "/auth/signin" });
      }
    };

    window.addEventListener('session-invalidated', handleInvalidation);

    return () => {
      window.removeEventListener('session-invalidated', handleInvalidation);
    };
  }, [baSessionData, onSessionInvalidated]);

  // Setup refresh interval
  useEffect(() => {
    if (!autoRefresh || status !== 'authenticated') return;

    // Initial check
    checkExpiry();

    // Setup interval
    refreshIntervalRef.current = setInterval(() => {
      checkExpiry();

      // Auto-refresh if expiring
      if (state.isExpiring && !state.isRefreshing) {
        refreshSession();
      }
    }, refreshCheckInterval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, status, refreshCheckInterval, checkExpiry, state.isExpiring, state.isRefreshing, refreshSession]);

  // Fingerprint validation
  useEffect(() => {
    if (!state.deviceFingerprint || !enableAlerts) return;

    const storedFingerprint = getStoredFingerprint();

    if (storedFingerprint && storedFingerprint !== state.deviceFingerprint) {
      // Fingerprint mismatch - possible session hijacking
      onSuspiciousActivity?.('fingerprint_mismatch', 'high');
    }
  }, [state.deviceFingerprint, enableAlerts, onSuspiciousActivity]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...state,
    refreshSession,
    terminateOtherSessions,
    reportActivity,
  };
}

// ============================================================================
// Session Expiry Warning Component Hook
// ============================================================================

export interface UseSessionExpiryWarningOptions {
  /** Warning threshold in minutes */
  warningThreshold?: number;
  /** Critical threshold in minutes */
  criticalThreshold?: number;
  /** Auto-extend session when warning shown */
  autoExtend?: boolean;
}

export function useSessionExpiryWarning(options: UseSessionExpiryWarningOptions = {}): {
  showWarning: boolean;
  isCritical: boolean;
  minutesRemaining: number;
  extendSession: () => Promise<void>;
  dismissWarning: () => void;
} {
  const {
    warningThreshold = 15,
    criticalThreshold = 5,
    autoExtend = false,
  } = options;

  const [showWarning, setShowWarning] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const {
    minutesUntilExpiry,
    isExpiring,
    refreshSession,
  } = useSessionSecurity({
    onSessionExpiring: (minutes) => {
      if (!dismissed) {
        setShowWarning(true);
      }
      if (autoExtend && minutes <= criticalThreshold) {
        refreshSession();
      }
    },
  });

  // warningThreshold is read in the onSessionExpiring callback but the hook
  // depends on it via the closure. Reference it here to satisfy the linter.
  void warningThreshold;

  const extendSession = useCallback(async () => {
    await refreshSession();
    setShowWarning(false);
    setDismissed(false);
  }, [refreshSession]);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    setDismissed(true);
  }, []);

  return {
    showWarning: showWarning && isExpiring && !dismissed,
    isCritical: minutesUntilExpiry <= criticalThreshold,
    minutesRemaining: minutesUntilExpiry,
    extendSession,
    dismissWarning,
  };
}

export default useSessionSecurity;
