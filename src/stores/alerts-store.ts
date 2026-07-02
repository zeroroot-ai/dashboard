import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { Alert } from '@/src/types/analytics';

/**
 * Alerts state interface for notification management.
 *
 * This store manages:
 * - Alert list and unread count
 * - Toast queue for real-time notifications (max 3 concurrent)
 * - Dropdown open/close state
 * - Do Not Disturb mode
 *
 * DND preference is persisted to localStorage via Zustand persist middleware.
 */
interface AlertsState {
  // State
  alerts: Alert[];
  isDropdownOpen: boolean;
  toastQueue: Alert[]; // Max 3 concurrent toasts
  doNotDisturb: boolean;

  // Computed values (getters)
  getUnreadCount: () => number;

  // Actions
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  markAsRead: (alertId: string) => void;
  markAllAsRead: () => void;
  dismissToast: (alertId: string) => void;
  toggleDropdown: () => void;
  setDoNotDisturb: (enabled: boolean) => void;
}

/**
 * Maximum number of concurrent toast notifications
 */
const MAX_TOAST_QUEUE = 3;

/**
 * Alerts store with localStorage persistence for DND preference.
 *
 * Persisted fields:
 * - doNotDisturb
 *
 * Non-persisted fields (reset on reload):
 * - alerts
 * - isDropdownOpen
 * - toastQueue
 */
export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      // Initial state
      alerts: [],
      isDropdownOpen: false,
      toastQueue: [],
      doNotDisturb: false,

      // Computed: get unread count
      getUnreadCount: () => {
        return get().alerts.filter((alert) => !alert.read).length;
      },

      // Set entire alerts list
      setAlerts: (alerts) => {
        set({ alerts });
      },

      // Add single alert and optionally add to toast queue
      addAlert: (alert) => {
        const currentAlerts = get().alerts;
        const doNotDisturb = get().doNotDisturb;
        const currentToastQueue = get().toastQueue;

        // Add to alerts list (prepend to show newest first)
        const updatedAlerts = [alert, ...currentAlerts];

        // Add to toast queue if not in DND mode and queue isn't full
        let updatedToastQueue = currentToastQueue;
        if (!doNotDisturb && currentToastQueue.length < MAX_TOAST_QUEUE) {
          updatedToastQueue = [...currentToastQueue, alert];
        }

        set({
          alerts: updatedAlerts,
          toastQueue: updatedToastQueue,
        });
      },

      // Mark single alert as read
      markAsRead: (alertId) => {
        const currentAlerts = get().alerts;
        const updatedAlerts = currentAlerts.map((alert) =>
          alert.id === alertId ? { ...alert, read: true } : alert
        );

        set({ alerts: updatedAlerts });
      },

      // Mark all alerts as read
      markAllAsRead: () => {
        const currentAlerts = get().alerts;
        const updatedAlerts = currentAlerts.map((alert) => ({
          ...alert,
          read: true,
        }));

        set({ alerts: updatedAlerts });
      },

      // Remove toast from queue
      dismissToast: (alertId) => {
        const currentToastQueue = get().toastQueue;
        const updatedToastQueue = currentToastQueue.filter((alert) => alert.id !== alertId);

        set({ toastQueue: updatedToastQueue });
      },

      // Toggle dropdown open/close
      toggleDropdown: () => {
        set({ isDropdownOpen: !get().isDropdownOpen });
      },

      // Set do not disturb mode
      setDoNotDisturb: (enabled) => {
        set({ doNotDisturb: enabled });
        // Clear toast queue when enabling DND
        if (enabled) {
          set({ toastQueue: [] });
        }
      },
    }),
    {
      name: 'gibson-dashboard-alerts',
      // Only persist doNotDisturb preference
      partialize: (state) => ({
        doNotDisturb: state.doNotDisturb,
      }),
    }
  )
);

/**
 * Hook to get alerts state - returns alerts array and unread count
 * Uses useShallow to prevent infinite re-render loops
 */
const useAlerts = () =>
  useAlertsStore(
    useShallow((state) => ({
      alerts: state.alerts,
      unreadCount: state.alerts.filter((alert) => !alert.read).length,
    }))
  );

/**
 * Hook to get dropdown state
 */
const useDropdown = () =>
  useAlertsStore(
    useShallow((state) => ({
      isDropdownOpen: state.isDropdownOpen,
      toggleDropdown: state.toggleDropdown,
    }))
  );

/**
 * Hook to get toast queue state
 */
const useToastQueue = () =>
  useAlertsStore(
    useShallow((state) => ({
      toastQueue: state.toastQueue,
      dismissToast: state.dismissToast,
    }))
  );

/**
 * Hook to get alert actions
 */
const useAlertActions = () =>
  useAlertsStore(
    useShallow((state) => ({
      setAlerts: state.setAlerts,
      addAlert: state.addAlert,
      markAsRead: state.markAsRead,
      markAllAsRead: state.markAllAsRead,
    }))
  );

/**
 * Hook to get DND state
 */
const useDoNotDisturb = () =>
  useAlertsStore(
    useShallow((state) => ({
      doNotDisturb: state.doNotDisturb,
      setDoNotDisturb: state.setDoNotDisturb,
    }))
  );
