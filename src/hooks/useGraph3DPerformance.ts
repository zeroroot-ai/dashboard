'use client';

/**
 * useGraph3DPerformance Hook
 *
 * Monitors 3D graph rendering performance, tracks FPS, detects performance
 * degradation, and provides optimization recommendations.
 *
 * Features:
 * - Real-time FPS measurement using requestAnimationFrame
 * - 1-second rolling average FPS calculation
 * - Automatic performance mode detection
 * - LOD quality auto-adjustment on sustained low FPS
 * - User-friendly optimization recommendations
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Performance mode based on FPS
 */
export type PerformanceMode = 'optimal' | 'reduced' | 'critical';

/**
 * Hook return value
 */
export interface UseGraph3DPerformanceReturn {
  /** Current instantaneous FPS */
  fps: number;
  /** Average FPS over last second */
  avgFPS: number;
  /** Current performance mode */
  performanceMode: PerformanceMode;
  /** Optimization recommendations */
  recommendations: string[];
  /** Whether auto LOD adjustment is active */
  autoLODActive: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const FPS_SAMPLE_SIZE = 60; // Number of frames to average (1 second at 60fps)
const LOW_FPS_THRESHOLD = 30;
const CRITICAL_FPS_THRESHOLD = 15;
const HIGH_NODE_COUNT_THRESHOLD = 500;
const LOW_FPS_DURATION_THRESHOLD = 5000; // 5 seconds of low FPS before action
const LOD_ADJUSTMENT_COOLDOWN = 10000; // 10 seconds between LOD adjustments

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useGraph3DPerformance - Monitor and optimize 3D graph rendering performance
 *
 * @param nodeCount - Current number of nodes in the graph
 * @param onLODQualityChange - Optional callback when LOD quality should be adjusted
 * @returns Performance metrics and recommendations
 *
 * @example
 * ```tsx
 * function Graph3D({ nodes }) {
 *   const { fps, avgFPS, performanceMode, recommendations } =
 *     useGraph3DPerformance(nodes.length, (quality) => {
 *       // quality is the new LOD level (0-100)
 *     });
 *
 *   return (
 *     <div>
 *       <p>FPS: {fps} (avg: {avgFPS})</p>
 *       <p>Mode: {performanceMode}</p>
 *       {recommendations.map((rec, i) => (
 *         <p key={i}>{rec}</p>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useGraph3DPerformance(
  nodeCount: number,
  onLODQualityChange?: (quality: number) => void
): UseGraph3DPerformanceReturn {
  const [fps, setFps] = useState(60);
  const [avgFPS, setAvgFPS] = useState(60);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>('optimal');
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [autoLODActive, setAutoLODActive] = useState(false);

  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const animationFrameRef = useRef<number | null>(null);
  const lowFPSStartTimeRef = useRef<number | null>(null);
  const lastLODAdjustmentRef = useRef<number>(0);
  const currentLODQualityRef = useRef<number>(80);

  /**
   * Calculate FPS from frame times
   */
  const calculateFPS = useCallback(() => {
    if (frameTimesRef.current.length === 0) return 60;

    const avgFrameTime =
      frameTimesRef.current.reduce((a, b) => a + b, 0) /
      frameTimesRef.current.length;

    return Math.round(1000 / avgFrameTime);
  }, []);

  /**
   * Determine performance mode from FPS
   */
  const getPerformanceMode = useCallback((currentFPS: number): PerformanceMode => {
    if (currentFPS < CRITICAL_FPS_THRESHOLD) {
      return 'critical';
    } else if (currentFPS < LOW_FPS_THRESHOLD) {
      return 'reduced';
    } else {
      return 'optimal';
    }
  }, []);

  /**
   * Generate recommendations based on performance and node count
   */
  const generateRecommendations = useCallback(
    (currentFPS: number, mode: PerformanceMode): string[] => {
      const recs: string[] = [];

      if (mode === 'critical') {
        recs.push('Critical: Performance is severely degraded');

        if (nodeCount > HIGH_NODE_COUNT_THRESHOLD) {
          recs.push(
            `Try filtering to reduce node count (currently ${nodeCount} nodes)`
          );
        }

        recs.push('Disabling animations and effects');
        recs.push('Consider using 2D graph view for better performance');
      } else if (mode === 'reduced') {
        recs.push(`Performance reduced (${currentFPS} FPS)`);

        if (nodeCount > HIGH_NODE_COUNT_THRESHOLD) {
          recs.push(
            `High node count detected (${nodeCount} nodes) - consider filtering`
          );
        }

        recs.push('Enabling performance mode with reduced detail');
        recs.push('Try hiding less important nodes to improve performance');
      }

      // Node count specific recommendations
      if (nodeCount > 1000) {
        recs.push('Very high node count - filtering strongly recommended');
      }

      return recs;
    },
    [nodeCount]
  );

  /**
   * Adjust LOD quality based on performance
   */
  const adjustLODQuality = useCallback(() => {
    const now = performance.now();

    // Check cooldown
    if (now - lastLODAdjustmentRef.current < LOD_ADJUSTMENT_COOLDOWN) {
      return;
    }

    const currentQuality = currentLODQualityRef.current;

    if (performanceMode === 'critical') {
      // Critical: reduce to minimum
      const newQuality = 20;
      if (newQuality !== currentQuality) {
        currentLODQualityRef.current = newQuality;
        lastLODAdjustmentRef.current = now;
        setAutoLODActive(true);
        onLODQualityChange?.(newQuality);
      }
    } else if (performanceMode === 'reduced') {
      // Reduced: lower quality
      const newQuality = 50;
      if (newQuality !== currentQuality && currentQuality > newQuality) {
        currentLODQualityRef.current = newQuality;
        lastLODAdjustmentRef.current = now;
        setAutoLODActive(true);
        onLODQualityChange?.(newQuality);
      }
    } else {
      // Optimal: restore quality if it was reduced
      const newQuality = 80;
      if (currentQuality < newQuality) {
        currentLODQualityRef.current = newQuality;
        lastLODAdjustmentRef.current = now;
        setAutoLODActive(false);
        onLODQualityChange?.(newQuality);
      }
    }
  }, [performanceMode, onLODQualityChange]);

  /**
   * Check for sustained low FPS
   */
  const checkSustainedLowFPS = useCallback(() => {
    const now = performance.now();

    if (avgFPS < LOW_FPS_THRESHOLD) {
      if (lowFPSStartTimeRef.current === null) {
        lowFPSStartTimeRef.current = now;
      } else if (now - lowFPSStartTimeRef.current >= LOW_FPS_DURATION_THRESHOLD) {
        // Sustained low FPS detected - adjust LOD
        adjustLODQuality();
      }
    } else {
      // FPS recovered
      lowFPSStartTimeRef.current = null;
    }
  }, [avgFPS, adjustLODQuality]);

  /**
   * Update performance metrics
   */
  const updateMetrics = useCallback(() => {
    const calculatedFPS = calculateFPS();
    const mode = getPerformanceMode(calculatedFPS);
    const recs = generateRecommendations(calculatedFPS, mode);

    setFps(calculatedFPS);
    setAvgFPS(calculatedFPS);
    setPerformanceMode(mode);
    setRecommendations(recs);
  }, [calculateFPS, getPerformanceMode, generateRecommendations]);

  /**
   * Measure frame time
   */
  const measureFrame = useCallback(() => {
    const now = performance.now();
    const frameTime = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    // Add to rolling window
    frameTimesRef.current.push(frameTime);

    // Keep only last FPS_SAMPLE_SIZE frames
    if (frameTimesRef.current.length > FPS_SAMPLE_SIZE) {
      frameTimesRef.current.shift();
    }

    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(measureFrame);
  }, []);

  // Start FPS monitoring on mount
  useEffect(() => {
    lastFrameTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(measureFrame);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [measureFrame]);

  // Update metrics every second
  useEffect(() => {
    const interval = setInterval(() => {
      updateMetrics();
      checkSustainedLowFPS();
    }, 1000);

    return () => clearInterval(interval);
  }, [updateMetrics, checkSustainedLowFPS]);

  // Handle tab visibility changes (pause monitoring when tab is hidden)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - pause monitoring
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      } else {
        // Tab visible - resume monitoring
        lastFrameTimeRef.current = performance.now();
        frameTimesRef.current = []; // Reset frame times
        animationFrameRef.current = requestAnimationFrame(measureFrame);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [measureFrame]);

  return {
    fps,
    avgFPS,
    performanceMode,
    recommendations,
    autoLODActive,
  };
}
