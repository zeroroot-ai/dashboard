/**
 * Alerts Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAlertsStore } from './alerts-store';
import type { Alert } from '@/src/types/analytics';

const createMockAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: `alert-${Date.now()}-${Math.random()}`,
  type: 'system',
  title: 'Test Alert',
  message: 'This is a test alert',
  severity: 'info',
  timestamp: new Date(),
  read: false,
  ...overrides,
});

describe('Alerts Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAlertsStore.setState({
      alerts: [],
      isDropdownOpen: false,
      toastQueue: [],
      doNotDisturb: false,
    });
  });

  describe('setAlerts', () => {
    it('should set the complete alerts list', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
      ];

      const store = useAlertsStore.getState();
      store.setAlerts(alerts);

      const state = useAlertsStore.getState();
      expect(state.alerts).toEqual(alerts);
    });

    it('should replace existing alerts', () => {
      const store = useAlertsStore.getState();
      store.setAlerts([createMockAlert({ id: 'alert-1' })]);
      store.setAlerts([createMockAlert({ id: 'alert-2' })]);

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(1);
      expect(state.alerts[0].id).toBe('alert-2');
    });
  });

  describe('addAlert', () => {
    it('should add a single alert to the list', () => {
      const alert = createMockAlert({ id: 'alert-1' });

      const store = useAlertsStore.getState();
      store.addAlert(alert);

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(1);
      expect(state.alerts[0]).toEqual(alert);
    });

    it('should prepend new alert to show newest first', () => {
      const store = useAlertsStore.getState();
      const alert1 = createMockAlert({ id: 'alert-1', title: 'First' });
      const alert2 = createMockAlert({ id: 'alert-2', title: 'Second' });

      store.addAlert(alert1);
      store.addAlert(alert2);

      const state = useAlertsStore.getState();
      expect(state.alerts[0].title).toBe('Second');
      expect(state.alerts[1].title).toBe('First');
    });

    it('should add alert to toast queue if not in DND mode', () => {
      const alert = createMockAlert({ id: 'alert-1' });

      const store = useAlertsStore.getState();
      store.addAlert(alert);

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(1);
      expect(state.toastQueue[0]).toEqual(alert);
    });

    it('should NOT add alert to toast queue if in DND mode', () => {
      const alert = createMockAlert({ id: 'alert-1' });

      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);
      store.addAlert(alert);

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(1); // Alert added to alerts list
      expect(state.toastQueue).toHaveLength(0); // But not to toast queue
    });

    it('should respect toast queue limit of 3', () => {
      const store = useAlertsStore.getState();

      // Add 5 alerts
      for (let i = 1; i <= 5; i++) {
        store.addAlert(createMockAlert({ id: `alert-${i}` }));
      }

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(5); // All added to alerts list
      expect(state.toastQueue).toHaveLength(3); // Only 3 in toast queue
    });

    it('should add first 3 alerts to toast queue', () => {
      const store = useAlertsStore.getState();
      const alert1 = createMockAlert({ id: 'alert-1' });
      const alert2 = createMockAlert({ id: 'alert-2' });
      const alert3 = createMockAlert({ id: 'alert-3' });
      const alert4 = createMockAlert({ id: 'alert-4' });

      store.addAlert(alert1);
      store.addAlert(alert2);
      store.addAlert(alert3);
      store.addAlert(alert4);

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(3);
      expect(state.toastQueue[0].id).toBe('alert-1');
      expect(state.toastQueue[1].id).toBe('alert-2');
      expect(state.toastQueue[2].id).toBe('alert-3');
    });
  });

  describe('markAsRead', () => {
    it('should mark a single alert as read', () => {
      const alert = createMockAlert({ id: 'alert-1', read: false });

      const store = useAlertsStore.getState();
      store.addAlert(alert);
      store.markAsRead('alert-1');

      const state = useAlertsStore.getState();
      expect(state.alerts[0].read).toBe(true);
    });

    it('should not affect other alerts', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: false }));

      store.markAsRead('alert-1');

      const state = useAlertsStore.getState();
      expect(state.alerts[0].read).toBe(false); // alert-2 (newest first) - should remain unread
      expect(state.alerts[1].read).toBe(true); // alert-1 - marked as read
    });

    it('should do nothing if alert ID does not exist', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: false }));

      store.markAsRead('non-existent');

      const state = useAlertsStore.getState();
      expect(state.alerts[0].read).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all alerts as read', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-3', read: false }));

      store.markAllAsRead();

      const state = useAlertsStore.getState();
      expect(state.alerts.every((alert) => alert.read)).toBe(true);
    });

    it('should work with empty alerts list', () => {
      const store = useAlertsStore.getState();
      store.markAllAsRead();

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(0);
    });

    it('should not affect alerts that are already read', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: true }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: false }));

      store.markAllAsRead();

      const state = useAlertsStore.getState();
      expect(state.alerts[0].read).toBe(true);
      expect(state.alerts[1].read).toBe(true);
    });
  });

  describe('dismissToast', () => {
    it('should remove toast from queue', () => {
      const alert = createMockAlert({ id: 'alert-1' });

      const store = useAlertsStore.getState();
      store.addAlert(alert);

      expect(useAlertsStore.getState().toastQueue).toHaveLength(1);

      store.dismissToast('alert-1');

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(0);
    });

    it('should not affect alerts list', () => {
      const alert = createMockAlert({ id: 'alert-1' });

      const store = useAlertsStore.getState();
      store.addAlert(alert);
      store.dismissToast('alert-1');

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(1); // Alert still in list
      expect(state.toastQueue).toHaveLength(0); // But removed from toast queue
    });

    it('should remove only the specified toast', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1' }));
      store.addAlert(createMockAlert({ id: 'alert-2' }));

      store.dismissToast('alert-1');

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(1);
      expect(state.toastQueue[0].id).toBe('alert-2');
    });
  });

  describe('toggleDropdown', () => {
    it('should toggle dropdown from closed to open', () => {
      const store = useAlertsStore.getState();

      expect(useAlertsStore.getState().isDropdownOpen).toBe(false);

      store.toggleDropdown();

      expect(useAlertsStore.getState().isDropdownOpen).toBe(true);
    });

    it('should toggle dropdown from open to closed', () => {
      const store = useAlertsStore.getState();
      store.toggleDropdown(); // Open
      store.toggleDropdown(); // Close

      expect(useAlertsStore.getState().isDropdownOpen).toBe(false);
    });
  });

  describe('setDoNotDisturb', () => {
    it('should enable do not disturb mode', () => {
      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);

      const state = useAlertsStore.getState();
      expect(state.doNotDisturb).toBe(true);
    });

    it('should disable do not disturb mode', () => {
      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);
      store.setDoNotDisturb(false);

      const state = useAlertsStore.getState();
      expect(state.doNotDisturb).toBe(false);
    });

    it('should clear toast queue when enabling DND', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1' }));
      store.addAlert(createMockAlert({ id: 'alert-2' }));

      expect(useAlertsStore.getState().toastQueue).toHaveLength(2);

      store.setDoNotDisturb(true);

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(0);
    });

    it('should not clear toast queue when disabling DND', () => {
      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);
      store.setDoNotDisturb(false);

      // Add alerts with DND off
      store.addAlert(createMockAlert({ id: 'alert-1' }));

      const state = useAlertsStore.getState();
      expect(state.toastQueue).toHaveLength(1);
    });
  });

  describe('getUnreadCount', () => {
    it('should return 0 when no alerts', () => {
      const store = useAlertsStore.getState();
      const count = store.getUnreadCount();

      expect(count).toBe(0);
    });

    it('should return count of unread alerts', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-3', read: true }));

      const count = store.getUnreadCount();

      expect(count).toBe(2);
    });

    it('should return 0 when all alerts are read', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: true }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: true }));

      const count = store.getUnreadCount();

      expect(count).toBe(0);
    });

    it('should update count after marking alerts as read', () => {
      const store = useAlertsStore.getState();
      store.addAlert(createMockAlert({ id: 'alert-1', read: false }));
      store.addAlert(createMockAlert({ id: 'alert-2', read: false }));

      expect(store.getUnreadCount()).toBe(2);

      store.markAsRead('alert-1');

      expect(store.getUnreadCount()).toBe(1);

      store.markAllAsRead();

      expect(store.getUnreadCount()).toBe(0);
    });
  });

  describe('DND behavior with alerts', () => {
    it('should add alerts to list but not toast queue when DND is enabled', () => {
      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);

      store.addAlert(createMockAlert({ id: 'alert-1' }));
      store.addAlert(createMockAlert({ id: 'alert-2' }));

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(2);
      expect(state.toastQueue).toHaveLength(0);
    });

    it('should resume adding to toast queue after disabling DND', () => {
      const store = useAlertsStore.getState();
      store.setDoNotDisturb(true);
      store.addAlert(createMockAlert({ id: 'alert-1' }));

      store.setDoNotDisturb(false);
      store.addAlert(createMockAlert({ id: 'alert-2' }));

      const state = useAlertsStore.getState();
      expect(state.alerts).toHaveLength(2);
      expect(state.toastQueue).toHaveLength(1);
      expect(state.toastQueue[0].id).toBe('alert-2');
    });
  });
});
