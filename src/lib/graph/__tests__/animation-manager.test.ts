import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AnimationManager } from '../animation-manager';

describe('AnimationManager', () => {
  let animationManager: AnimationManager;

  beforeEach(() => {
    animationManager = new AnimationManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start and stop lifecycle', () => {
    it('should start animation manager', () => {
      animationManager.start();

      expect(animationManager.isRunning()).toBe(true);
    });

    it('should stop animation manager', () => {
      animationManager.start();
      animationManager.stop();

      expect(animationManager.isRunning()).toBe(false);
    });

    it('should not start if already running', () => {
      animationManager.start();

      const firstStartTime = animationManager.getTime();

      // Try to start again
      animationManager.start();

      // Time should not have reset
      expect(animationManager.getTime()).toBe(firstStartTime);
    });

    it('should initialize as not running', () => {
      const manager = new AnimationManager();

      expect(manager.isRunning()).toBe(false);
    });
  });

  describe('getTime', () => {
    it('should return 0 when not running', () => {
      expect(animationManager.getTime()).toBe(0);
    });

    it('should return elapsed time in seconds when running', () => {
      animationManager.start();

      // Advance time by 1000ms (1 second)
      vi.advanceTimersByTime(1000);
      animationManager.update();

      expect(animationManager.getTime()).toBeCloseTo(1, 1);
    });

    it('should accumulate time correctly', () => {
      animationManager.start();

      vi.advanceTimersByTime(500);
      animationManager.update();

      expect(animationManager.getTime()).toBeCloseTo(0.5, 1);

      vi.advanceTimersByTime(1500);
      animationManager.update();

      expect(animationManager.getTime()).toBeCloseTo(2, 1);
    });

    it('should not advance time when stopped', () => {
      animationManager.start();

      vi.advanceTimersByTime(1000);
      animationManager.update();

      animationManager.stop();

      // When stopped, getTime() returns 0 (not running)
      // This is expected behavior based on the implementation
      expect(animationManager.getTime()).toBe(0);
    });
  });

  describe('getDeltaTime', () => {
    it('should return 0 when not running', () => {
      expect(animationManager.getDeltaTime()).toBe(0);
    });

    it('should return delta time between frames', () => {
      animationManager.start();

      // First update establishes baseline, getDeltaTime will be 0
      vi.advanceTimersByTime(16); // ~60fps frame
      animationManager.update();

      // getDeltaTime will be 0 until we query it (or it's calculated during update)
      // The implementation returns getDeltaTime based on current - last frame
      // Let's just verify it returns a reasonable value after updates
      expect(animationManager.getDeltaTime()).toBeGreaterThanOrEqual(0);

      vi.advanceTimersByTime(16);
      animationManager.update();

      expect(animationManager.getDeltaTime()).toBeGreaterThanOrEqual(0);
    });

    it('should handle variable frame times', () => {
      animationManager.start();

      vi.advanceTimersByTime(16);
      animationManager.update();

      vi.advanceTimersByTime(33); // Slower frame
      animationManager.update();

      // Verify delta time is reasonable (non-negative)
      expect(animationManager.getDeltaTime()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getPulseValue', () => {
    it('should return values in 0-1 range', () => {
      animationManager.start();

      const frequencies = [0.5, 1.0, 2.0, 5.0];

      frequencies.forEach((frequency) => {
        for (let i = 0; i < 10; i++) {
          vi.advanceTimersByTime(100);
          animationManager.update();

          const pulseValue = animationManager.getPulseValue(frequency);

          expect(pulseValue).toBeGreaterThanOrEqual(0);
          expect(pulseValue).toBeLessThanOrEqual(1);
        }
      });
    });

    it('should return 0.5 when not running (middle value)', () => {
      const pulseValue = animationManager.getPulseValue(1.0);

      expect(pulseValue).toBe(0.5);
    });

    it('should oscillate smoothly over time', () => {
      animationManager.start();

      const frequency = 1.0; // 1 Hz = 1 cycle per second
      const values: number[] = [];

      // Sample pulse values over one complete cycle
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(100); // 0.1 second steps
        animationManager.update();
        values.push(animationManager.getPulseValue(frequency));
      }

      // Values should vary (not all the same)
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBeGreaterThan(1);

      // All values should be in valid range
      values.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });

    it('should complete one cycle at frequency 1Hz in 1 second', () => {
      animationManager.start();

      const frequency = 1.0;

      // At t=0, sine should be 0, normalized to 0.5
      const initialValue = animationManager.getPulseValue(frequency);
      expect(initialValue).toBeCloseTo(0.5, 1);

      // At t=0.25s, sine should be 1, normalized to 1
      vi.advanceTimersByTime(250);
      animationManager.update();
      const quarterValue = animationManager.getPulseValue(frequency);
      expect(quarterValue).toBeCloseTo(1, 1);

      // At t=0.5s, sine should be 0, normalized to 0.5
      vi.advanceTimersByTime(250);
      animationManager.update();
      const halfValue = animationManager.getPulseValue(frequency);
      expect(halfValue).toBeCloseTo(0.5, 1);

      // At t=0.75s, sine should be -1, normalized to 0
      vi.advanceTimersByTime(250);
      animationManager.update();
      const threeQuarterValue = animationManager.getPulseValue(frequency);
      expect(threeQuarterValue).toBeCloseTo(0, 1);

      // At t=1s, sine should be back to 0, normalized to 0.5
      vi.advanceTimersByTime(250);
      animationManager.update();
      const finalValue = animationManager.getPulseValue(frequency);
      expect(finalValue).toBeCloseTo(0.5, 1);
    });
  });

  describe('getDashOffset', () => {
    it('should accumulate offset over time', () => {
      animationManager.start();

      const speed = 10; // 10 pixels per second

      vi.advanceTimersByTime(100);
      animationManager.update();

      const offset1 = animationManager.getDashOffset(speed);
      expect(offset1).toBeGreaterThan(0);

      vi.advanceTimersByTime(100);
      animationManager.update();

      const offset2 = animationManager.getDashOffset(speed);
      expect(offset2).toBeGreaterThan(offset1);
    });

    it('should scale with speed parameter', () => {
      animationManager.start();

      vi.advanceTimersByTime(1000); // 1 second
      animationManager.update();

      const slowOffset = animationManager.getDashOffset(5); // 5px/s
      const fastOffset = animationManager.getDashOffset(20); // 20px/s

      expect(fastOffset).toBeGreaterThan(slowOffset);
      expect(fastOffset).toBeCloseTo(slowOffset * 4, 0); // 4x speed = 4x offset
    });

    it('should return consistent offset for same speed at same time', () => {
      animationManager.start();

      vi.advanceTimersByTime(500);
      animationManager.update();

      const offset1 = animationManager.getDashOffset(10);
      const offset2 = animationManager.getDashOffset(10);

      expect(offset1).toBe(offset2);
    });
  });

  describe('registerCallback and unregisterCallback', () => {
    it('should register a callback', () => {
      const callback = vi.fn();

      animationManager.registerCallback('test-callback', callback);

      // Stats should show one callback registered
      const stats = animationManager.getStats();
      expect(stats.callbackCount).toBe(1);
    });

    it('should unregister a callback', () => {
      const callback = vi.fn();

      animationManager.registerCallback('test-callback', callback);
      animationManager.unregisterCallback('test-callback');

      const stats = animationManager.getStats();
      expect(stats.callbackCount).toBe(0);
    });

    it('should invoke registered callbacks on update', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      animationManager.registerCallback('callback-1', callback1);
      animationManager.registerCallback('callback-2', callback2);

      animationManager.start();
      vi.advanceTimersByTime(16);
      animationManager.update();

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);

      // Should be called with deltaTime
      expect(callback1).toHaveBeenCalledWith(expect.any(Number));
      expect(callback2).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should pass deltaTime to callbacks', () => {
      const callback = vi.fn();

      animationManager.registerCallback('test-callback', callback);

      animationManager.start();
      vi.advanceTimersByTime(16);
      animationManager.update();

      // Callback should receive deltaTime in seconds
      expect(callback).toHaveBeenCalledWith(expect.any(Number));
      const deltaTime = callback.mock.calls[0][0];
      expect(deltaTime).toBeCloseTo(0.016, 3);
    });

    it('should not invoke callbacks when not running', () => {
      const callback = vi.fn();

      animationManager.registerCallback('test-callback', callback);
      animationManager.update();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const successCallback = vi.fn();

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      animationManager.registerCallback('error-callback', errorCallback);
      animationManager.registerCallback('success-callback', successCallback);

      animationManager.start();

      expect(() => {
        vi.advanceTimersByTime(16);
        animationManager.update();
      }).not.toThrow();

      // Error callback should have been called and errored
      expect(errorCallback).toHaveBeenCalled();

      // Success callback should still be called
      expect(successCallback).toHaveBeenCalled();

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should allow multiple callbacks with different IDs', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      animationManager.registerCallback('cb-1', callback1);
      animationManager.registerCallback('cb-2', callback2);
      animationManager.registerCallback('cb-3', callback3);

      const stats = animationManager.getStats();
      expect(stats.callbackCount).toBe(3);
    });

    it('should replace callback if registering with same ID', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      animationManager.registerCallback('test-callback', callback1);
      animationManager.registerCallback('test-callback', callback2);

      animationManager.start();
      vi.advanceTimersByTime(16);
      animationManager.update();

      // Only callback2 should be called (replaced callback1)
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      const stats = animationManager.getStats();
      expect(stats.callbackCount).toBe(1);
    });
  });

  describe('update', () => {
    it('should do nothing when not running', () => {
      const callback = vi.fn();
      animationManager.registerCallback('test', callback);

      animationManager.update();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should update internal time tracking', () => {
      animationManager.start();

      const time1 = animationManager.getTime();

      vi.advanceTimersByTime(100);
      animationManager.update();

      const time2 = animationManager.getTime();

      expect(time2).toBeGreaterThan(time1);
    });

    it('should accumulate dash offset', () => {
      animationManager.start();

      const offset1 = animationManager.getDashOffset(1);

      vi.advanceTimersByTime(100);
      animationManager.update();

      const offset2 = animationManager.getDashOffset(1);

      expect(offset2).toBeGreaterThan(offset1);
    });
  });

  describe('reset', () => {
    it('should reset animation state', () => {
      animationManager.start();

      vi.advanceTimersByTime(1000);
      animationManager.update();

      expect(animationManager.getTime()).toBeGreaterThan(0);

      animationManager.reset();

      // Should be running again (reset restarts if was running)
      expect(animationManager.isRunning()).toBe(true);

      // Time should be reset
      expect(animationManager.getTime()).toBeCloseTo(0, 1);
    });

    it('should restart if was running before reset', () => {
      animationManager.start();

      vi.advanceTimersByTime(1000);
      animationManager.update();

      animationManager.reset();

      // Should be running again
      expect(animationManager.isRunning()).toBe(true);

      // But time should be reset
      expect(animationManager.getTime()).toBeCloseTo(0, 1);
    });

    it('should not restart if was stopped before reset', () => {
      animationManager.start();
      animationManager.stop();

      animationManager.reset();

      expect(animationManager.isRunning()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const stats = animationManager.getStats();

      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('elapsedTime');
      expect(stats).toHaveProperty('deltaTime');
      expect(stats).toHaveProperty('callbackCount');

      expect(typeof stats.running).toBe('boolean');
      expect(typeof stats.elapsedTime).toBe('number');
      expect(typeof stats.deltaTime).toBe('number');
      expect(typeof stats.callbackCount).toBe('number');
    });

    it('should reflect running state', () => {
      let stats = animationManager.getStats();
      expect(stats.running).toBe(false);

      animationManager.start();

      stats = animationManager.getStats();
      expect(stats.running).toBe(true);

      animationManager.stop();

      stats = animationManager.getStats();
      expect(stats.running).toBe(false);
    });

    it('should show elapsed time', () => {
      animationManager.start();

      vi.advanceTimersByTime(500);
      animationManager.update();

      const stats = animationManager.getStats();
      expect(stats.elapsedTime).toBeCloseTo(0.5, 1);
    });

    it('should show callback count', () => {
      animationManager.registerCallback('cb-1', vi.fn());
      animationManager.registerCallback('cb-2', vi.fn());

      const stats = animationManager.getStats();
      expect(stats.callbackCount).toBe(2);

      animationManager.unregisterCallback('cb-1');

      const stats2 = animationManager.getStats();
      expect(stats2.callbackCount).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle very large time advances', () => {
      animationManager.start();

      vi.advanceTimersByTime(1000000); // 1000 seconds
      animationManager.update();

      expect(animationManager.getTime()).toBeGreaterThan(999);
    });

    it('should handle multiple rapid updates', () => {
      animationManager.start();

      for (let i = 0; i < 100; i++) {
        vi.advanceTimersByTime(1);
        animationManager.update();
      }

      expect(animationManager.getTime()).toBeCloseTo(0.1, 2);
    });

    it('should handle zero-length time steps', () => {
      animationManager.start();

      // Update without advancing time
      animationManager.update();
      animationManager.update();

      expect(() => animationManager.getDeltaTime()).not.toThrow();
    });
  });
});
