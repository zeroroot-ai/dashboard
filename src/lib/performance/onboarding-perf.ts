/**
 * Onboarding Performance Optimization Utilities
 *
 * Provides lazy loading, preloading, caching, and performance
 * monitoring for the onboarding wizard.
 */

import * as React from 'react';
import { WIZARD_STEPS, type WizardStepId } from '@/src/types/onboarding';

// ============================================================================
// Lazy Loading Configuration
// ============================================================================

/**
 * Step component lazy loaders
 * These create dynamic imports that are only loaded when needed
 */
export const lazyStepComponents = {
  welcome: React.lazy(
    () => import('@/app/(dashboard)/onboarding/components/WelcomeStep')
  ),
  'llm-provider': React.lazy(
    () => import('@/app/(dashboard)/onboarding/components/LLMProviderStep')
  ),
  'agent-selection': React.lazy(
    () => import('@/app/(dashboard)/onboarding/components/AgentSelectionStep')
  ),
  'mission-creation': React.lazy(
    () => import('@/app/(dashboard)/onboarding/components/MissionCreationStep')
  ),
  completion: React.lazy(
    () => import('@/app/(dashboard)/onboarding/components/CompletionStep')
  ),
} as const;

/**
 * Get lazy component for a step
 */
export function getLazyStepComponent(
  stepId: WizardStepId
): React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>> | null {
  return lazyStepComponents[stepId] || null;
}

// ============================================================================
// Preloading
// ============================================================================

/** Track which steps have been preloaded */
const preloadedSteps = new Set<WizardStepId>();

/**
 * Preload the next step component
 */
export async function preloadNextStep(currentStepIndex: number): Promise<void> {
  const nextStepIndex = currentStepIndex + 1;
  if (nextStepIndex >= WIZARD_STEPS.length) return;

  const nextStepId = WIZARD_STEPS[nextStepIndex].id;
  await preloadStep(nextStepId);
}

/**
 * Preload a specific step component
 */
export async function preloadStep(stepId: WizardStepId): Promise<void> {
  if (preloadedSteps.has(stepId)) return;

  try {
    switch (stepId) {
      case 'welcome':
        await import('@/app/(dashboard)/onboarding/components/WelcomeStep');
        break;
      case 'llm-provider':
        await import('@/app/(dashboard)/onboarding/components/LLMProviderStep');
        break;
      case 'agent-selection':
        await import('@/app/(dashboard)/onboarding/components/AgentSelectionStep');
        break;
      case 'mission-creation':
        await import('@/app/(dashboard)/onboarding/components/MissionCreationStep');
        break;
      case 'completion':
        await import('@/app/(dashboard)/onboarding/components/CompletionStep');
        break;
    }
    preloadedSteps.add(stepId);
  } catch (error) {
    console.error(`[Performance] Failed to preload step: ${stepId}`, error);
  }
}

/**
 * Preload all step components (for fast navigation)
 */
export async function preloadAllSteps(): Promise<void> {
  await Promise.all(
    WIZARD_STEPS.map((step) => preloadStep(step.id))
  );
}

/**
 * Preload critical resources for onboarding
 */
export function preloadCriticalResources(): void {
  if (typeof document === 'undefined') return;

  // Preload critical fonts
  const fontPreloads = [
    '/fonts/inter-var.woff2',
  ];

  fontPreloads.forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  });

  // Preconnect to API endpoints
  const preconnects = [
    '/api/onboarding',
    '/api/components/agents',
    '/api/templates',
  ];

  preconnects.forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    document.head.appendChild(link);
  });
}

// ============================================================================
// Help Content Caching
// ============================================================================

/** Help content cache */
const helpContentCache = new Map<string, {
  content: string;
  timestamp: number;
}>();

/** Cache TTL in milliseconds (5 minutes) */
const HELP_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get help content from cache or fetch
 */
export async function getCachedHelpContent(
  topicId: string,
  fetcher: () => Promise<string>
): Promise<string> {
  const cached = helpContentCache.get(topicId);
  const now = Date.now();

  if (cached && now - cached.timestamp < HELP_CACHE_TTL) {
    return cached.content;
  }

  const content = await fetcher();
  helpContentCache.set(topicId, { content, timestamp: now });
  return content;
}

/**
 * Preload help content for current context
 */
export async function preloadHelpContent(
  topicIds: string[],
  fetcher: (topicId: string) => Promise<string>
): Promise<void> {
  // Use requestIdleCallback for non-critical preloading
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      topicIds.forEach((topicId) => {
        getCachedHelpContent(topicId, () => fetcher(topicId));
      });
    });
  }
}

/**
 * Clear help content cache
 */
export function clearHelpCache(): void {
  helpContentCache.clear();
}

// ============================================================================
// API Response Caching
// ============================================================================

/** API response cache */
const apiCache = new Map<string, {
  data: unknown;
  timestamp: number;
  ttl: number;
}>();

/**
 * Get API response from cache or fetch
 */
export async function getCachedAPIResponse<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttl: number = 60000 // 1 minute default
): Promise<T> {
  const cached = apiCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < cached.ttl) {
    return cached.data as T;
  }

  const data = await fetcher();
  apiCache.set(cacheKey, { data, timestamp: now, ttl });
  return data;
}

/**
 * Invalidate specific cache entry
 */
export function invalidateCache(cacheKey: string): void {
  apiCache.delete(cacheKey);
}

/**
 * Clear all API cache
 */
export function clearAPICache(): void {
  apiCache.clear();
}

// ============================================================================
// Performance Monitoring
// ============================================================================

/** Performance marks for wizard */
const performanceMarks = {
  WIZARD_START: 'gibson:wizard:start',
  WIZARD_END: 'gibson:wizard:end',
  STEP_START: (stepId: string) => `gibson:wizard:step:${stepId}:start`,
  STEP_END: (stepId: string) => `gibson:wizard:step:${stepId}:end`,
  LLM_VALIDATION_START: 'gibson:wizard:llm-validation:start',
  LLM_VALIDATION_END: 'gibson:wizard:llm-validation:end',
  MISSION_CREATE_START: 'gibson:wizard:mission-create:start',
  MISSION_CREATE_END: 'gibson:wizard:mission-create:end',
};

/**
 * Mark performance point
 */
export function markPerformance(markName: string): void {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(markName);
  }
}

/**
 * Measure performance between two marks
 */
export function measurePerformance(
  measureName: string,
  startMark: string,
  endMark: string
): PerformanceMeasure | null {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      return performance.measure(measureName, startMark, endMark);
    } catch (error) {
      console.error('[Performance] Measurement error:', error);
      return null;
    }
  }
  return null;
}

/**
 * Mark wizard start
 */
export function markWizardStart(): void {
  markPerformance(performanceMarks.WIZARD_START);
}

/**
 * Mark wizard end and return duration
 */
export function markWizardEnd(): number {
  markPerformance(performanceMarks.WIZARD_END);
  const measure = measurePerformance(
    'gibson:wizard:total',
    performanceMarks.WIZARD_START,
    performanceMarks.WIZARD_END
  );
  return measure?.duration || 0;
}

/**
 * Mark step start
 */
export function markStepStart(stepId: WizardStepId): void {
  markPerformance(performanceMarks.STEP_START(stepId));
}

/**
 * Mark step end and return duration
 */
export function markStepEnd(stepId: WizardStepId): number {
  markPerformance(performanceMarks.STEP_END(stepId));
  const measure = measurePerformance(
    `gibson:wizard:step:${stepId}`,
    performanceMarks.STEP_START(stepId),
    performanceMarks.STEP_END(stepId)
  );
  return measure?.duration || 0;
}

/**
 * Get all wizard performance metrics
 */
export function getWizardMetrics(): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (typeof performance !== 'undefined' && performance.getEntriesByType) {
    const measures = performance.getEntriesByType('measure');
    measures
      .filter((m) => m.name.startsWith('gibson:wizard:'))
      .forEach((m) => {
        metrics[m.name] = m.duration;
      });
  }

  return metrics;
}

/**
 * Clear wizard performance marks
 */
export function clearWizardMetrics(): void {
  if (typeof performance !== 'undefined') {
    performance.clearMarks();
    performance.clearMeasures();
  }
}

// ============================================================================
// Bundle Size Optimization
// ============================================================================

/**
 * Conditionally load heavy dependencies
 */
export async function loadHeavyDependency<T>(
  condition: boolean,
  loader: () => Promise<T>
): Promise<T | null> {
  if (!condition) return null;
  return loader();
}

/**
 * Load markdown renderer only when needed
 */
export async function loadMarkdownRenderer(): Promise<typeof import('react-markdown') | null> {
  return loadHeavyDependency(true, () => import('react-markdown'));
}

/**
 * Load syntax highlighter only when needed
 */
export async function loadSyntaxHighlighter(): Promise<typeof import('react-syntax-highlighter') | null> {
  return loadHeavyDependency(true, () => import('react-syntax-highlighter'));
}

// ============================================================================
// React Hooks
// ============================================================================

/**
 * usePreloadNextStep Hook
 *
 * Preloads the next step when current step completes validation.
 */
export function usePreloadNextStep(
  currentStepIndex: number,
  isCurrentStepValid: boolean
): void {
  React.useEffect(() => {
    if (isCurrentStepValid) {
      preloadNextStep(currentStepIndex);
    }
  }, [currentStepIndex, isCurrentStepValid]);
}

/**
 * useStepPerformance Hook
 *
 * Tracks performance for the current step.
 */
export function useStepPerformance(stepId: WizardStepId): {
  stepDuration: number;
} {
  const [stepDuration, setStepDuration] = React.useState(0);

  React.useEffect(() => {
    markStepStart(stepId);

    return () => {
      const duration = markStepEnd(stepId);
      setStepDuration(duration);
    };
  }, [stepId]);

  return { stepDuration };
}

/**
 * useWizardPerformance Hook
 *
 * Tracks overall wizard performance.
 */
export function useWizardPerformance(): {
  wizardDuration: number;
  getMetrics: () => Record<string, number>;
} {
  const [wizardDuration, setWizardDuration] = React.useState(0);

  React.useEffect(() => {
    markWizardStart();

    return () => {
      const duration = markWizardEnd();
      setWizardDuration(duration);
    };
  }, []);

  return {
    wizardDuration,
    getMetrics: getWizardMetrics,
  };
}

/**
 * useDeferredValue Hook wrapper for step content
 *
 * Defers non-critical updates for smoother transitions.
 */
export function useDeferredStepContent<T>(content: T): T {
  return React.useDeferredValue(content);
}

/**
 * useIntersectionPreload Hook
 *
 * Preloads content when element comes into view.
 */
export function useIntersectionPreload(
  ref: React.RefObject<HTMLElement>,
  preloadFn: () => void
): void {
  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          preloadFn();
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, preloadFn]);
}

// ============================================================================
// Image Optimization
// ============================================================================

/**
 * Get optimized image URL
 */
export function getOptimizedImageUrl(
  src: string,
  width: number,
  quality: number = 75
): string {
  // Use Next.js image optimization when available
  if (src.startsWith('/')) {
    return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
  }
  return src;
}

/**
 * Preload critical images
 */
export function preloadImages(imageSrcs: string[]): void {
  if (typeof document === 'undefined') return;

  imageSrcs.forEach((src) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
  });
}

// ============================================================================
// Export
// ============================================================================

export default {
  // Lazy loading
  lazyStepComponents,
  getLazyStepComponent,

  // Preloading
  preloadNextStep,
  preloadStep,
  preloadAllSteps,
  preloadCriticalResources,

  // Help caching
  getCachedHelpContent,
  preloadHelpContent,
  clearHelpCache,

  // API caching
  getCachedAPIResponse,
  invalidateCache,
  clearAPICache,

  // Performance monitoring
  markPerformance,
  measurePerformance,
  markWizardStart,
  markWizardEnd,
  markStepStart,
  markStepEnd,
  getWizardMetrics,
  clearWizardMetrics,

  // Bundle optimization
  loadHeavyDependency,
  loadMarkdownRenderer,
  loadSyntaxHighlighter,

  // Image optimization
  getOptimizedImageUrl,
  preloadImages,

  // Hooks
  usePreloadNextStep,
  useStepPerformance,
  useWizardPerformance,
  useDeferredStepContent,
  useIntersectionPreload,
};
