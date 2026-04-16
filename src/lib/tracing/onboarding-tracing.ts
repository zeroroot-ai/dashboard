/**
 * Onboarding OpenTelemetry Tracing
 *
 * Provides distributed tracing for onboarding wizard operations.
 * Tracks API calls, state persistence, and key interactions.
 */

import { trace, SpanKind, SpanStatusCode, context, propagation } from '@opentelemetry/api';
import type { Span, Tracer, SpanContext } from '@opentelemetry/api';
import { WizardStepId, LLMProviderType as LLMProvider } from '@/src/types/onboarding';

// ============================================================================
// Tracer Configuration
// ============================================================================

const TRACER_NAME = 'gibson.dashboard.onboarding';
const TRACER_VERSION = '1.0.0';

/**
 * Get the onboarding tracer instance
 */
export function getOnboardingTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// ============================================================================
// Span Attribute Keys
// ============================================================================

const SpanAttributes = {
  // User context
  USER_ID: 'user.id',
  TENANT_ID: 'tenant.id',
  SESSION_ID: 'session.id',

  // Wizard context
  WIZARD_STEP_ID: 'onboarding.wizard.step.id',
  WIZARD_STEP_INDEX: 'onboarding.wizard.step.index',
  WIZARD_TOTAL_STEPS: 'onboarding.wizard.total_steps',
  WIZARD_IS_RESUME: 'onboarding.wizard.is_resume',
  WIZARD_COMPLETED_STEPS: 'onboarding.wizard.completed_steps',

  // LLM context
  LLM_PROVIDER: 'onboarding.llm.provider',
  LLM_VALIDATION_RESULT: 'onboarding.llm.validation.result',
  LLM_VALIDATION_ERROR_TYPE: 'onboarding.llm.validation.error_type',

  // Agent context
  AGENT_ID: 'onboarding.agent.id',
  AGENT_NAME: 'onboarding.agent.name',
  AGENT_DIFFICULTY: 'onboarding.agent.difficulty',

  // Template context
  TEMPLATE_ID: 'onboarding.template.id',
  TEMPLATE_NAME: 'onboarding.template.name',
  TEMPLATE_CATEGORY: 'onboarding.template.category',

  // Mission context
  MISSION_ID: 'onboarding.mission.id',

  // State persistence
  STATE_STORAGE_TYPE: 'onboarding.state.storage_type',
  STATE_OPERATION: 'onboarding.state.operation',
  STATE_SIZE_BYTES: 'onboarding.state.size_bytes',

  // Error context
  ERROR_TYPE: 'error.type',
  ERROR_MESSAGE: 'error.message',
} as const;

// ============================================================================
// Span Event Names
// ============================================================================

const SpanEvents = {
  STEP_STARTED: 'step.started',
  STEP_COMPLETED: 'step.completed',
  STEP_SKIPPED: 'step.skipped',
  VALIDATION_STARTED: 'validation.started',
  VALIDATION_COMPLETED: 'validation.completed',
  STATE_SAVED: 'state.saved',
  STATE_LOADED: 'state.loaded',
  ERROR_OCCURRED: 'error.occurred',
} as const;

// ============================================================================
// Tracing Utilities
// ============================================================================

/**
 * Create a span with common onboarding attributes
 */
export function createOnboardingSpan(
  name: string,
  userId: string,
  tenantId: string,
  kind: SpanKind = SpanKind.INTERNAL
): Span {
  const tracer = getOnboardingTracer();
  const span = tracer.startSpan(name, { kind });

  span.setAttributes({
    [SpanAttributes.USER_ID]: userId,
    [SpanAttributes.TENANT_ID]: tenantId,
    [SpanAttributes.SESSION_ID]: getSessionId(),
  });

  return span;
}

/**
 * Get session ID for span context
 */
function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  return sessionStorage.getItem('gibson:session_id') || 'unknown';
}

/**
 * Add wizard context to span
 */
export function addWizardContext(
  span: Span,
  stepId: WizardStepId,
  stepIndex: number,
  totalSteps: number,
  completedSteps: WizardStepId[]
): void {
  span.setAttributes({
    [SpanAttributes.WIZARD_STEP_ID]: stepId,
    [SpanAttributes.WIZARD_STEP_INDEX]: stepIndex,
    [SpanAttributes.WIZARD_TOTAL_STEPS]: totalSteps,
    [SpanAttributes.WIZARD_COMPLETED_STEPS]: completedSteps.length,
  });
}

/**
 * Record error on span
 */
export function recordSpanError(
  span: Span,
  error: Error,
  errorType: string = 'unknown'
): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.setAttributes({
    [SpanAttributes.ERROR_TYPE]: errorType,
    [SpanAttributes.ERROR_MESSAGE]: sanitizeErrorMessage(error.message),
  });
  span.recordException(error);
}

/**
 * Sanitize error message to remove sensitive data
 */
function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9-_]+/g, '[API_KEY]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .substring(0, 500);
}

// ============================================================================
// Wizard Tracing Functions
// ============================================================================

/**
 * Trace wizard navigation
 */
export async function traceWizardNavigation<T>(
  userId: string,
  tenantId: string,
  stepId: WizardStepId,
  stepIndex: number,
  operation: () => Promise<T>
): Promise<T> {
  const span = createOnboardingSpan(
    `onboarding.wizard.navigate.${stepId}`,
    userId,
    tenantId,
    SpanKind.INTERNAL
  );

  span.setAttributes({
    [SpanAttributes.WIZARD_STEP_ID]: stepId,
    [SpanAttributes.WIZARD_STEP_INDEX]: stepIndex,
  });

  try {
    span.addEvent(SpanEvents.STEP_STARTED, {
      [SpanAttributes.WIZARD_STEP_ID]: stepId,
    });

    const result = await operation();

    span.addEvent(SpanEvents.STEP_COMPLETED, {
      [SpanAttributes.WIZARD_STEP_ID]: stepId,
    });

    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordSpanError(span, error as Error, 'navigation_error');
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace LLM validation
 */
export async function traceLLMValidation<T>(
  userId: string,
  tenantId: string,
  provider: LLMProvider,
  operation: () => Promise<T>
): Promise<T> {
  const span = createOnboardingSpan(
    `onboarding.llm.validate.${provider}`,
    userId,
    tenantId,
    SpanKind.CLIENT
  );

  span.setAttributes({
    [SpanAttributes.LLM_PROVIDER]: provider,
  });

  try {
    span.addEvent(SpanEvents.VALIDATION_STARTED, {
      [SpanAttributes.LLM_PROVIDER]: provider,
    });

    const result = await operation();

    span.addEvent(SpanEvents.VALIDATION_COMPLETED, {
      [SpanAttributes.LLM_PROVIDER]: provider,
      [SpanAttributes.LLM_VALIDATION_RESULT]: 'success',
    });

    span.setStatus({ code: SpanStatusCode.OK });
    span.setAttribute(SpanAttributes.LLM_VALIDATION_RESULT, 'success');
    return result;
  } catch (error) {
    const err = error as Error;
    span.addEvent(SpanEvents.VALIDATION_COMPLETED, {
      [SpanAttributes.LLM_PROVIDER]: provider,
      [SpanAttributes.LLM_VALIDATION_RESULT]: 'failure',
      [SpanAttributes.LLM_VALIDATION_ERROR_TYPE]: err.name,
    });
    recordSpanError(span, err, 'validation_error');
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace state persistence operations
 */
export async function traceStatePersistence<T>(
  userId: string,
  tenantId: string,
  operation: 'save' | 'load' | 'sync',
  storageType: 'redis' | 'localStorage' | 'hybrid',
  fn: () => Promise<T>
): Promise<T> {
  const span = createOnboardingSpan(
    `onboarding.state.${operation}`,
    userId,
    tenantId,
    SpanKind.CLIENT
  );

  span.setAttributes({
    [SpanAttributes.STATE_OPERATION]: operation,
    [SpanAttributes.STATE_STORAGE_TYPE]: storageType,
  });

  try {
    const result = await fn();

    span.addEvent(operation === 'save' ? SpanEvents.STATE_SAVED : SpanEvents.STATE_LOADED, {
      [SpanAttributes.STATE_STORAGE_TYPE]: storageType,
    });

    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordSpanError(span, error as Error, 'state_persistence_error');
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace mission creation
 */
export async function traceMissionCreation<T>(
  userId: string,
  tenantId: string,
  templateId: string,
  templateName: string,
  operation: () => Promise<T>
): Promise<T> {
  const span = createOnboardingSpan(
    'onboarding.mission.create',
    userId,
    tenantId,
    SpanKind.CLIENT
  );

  span.setAttributes({
    [SpanAttributes.TEMPLATE_ID]: templateId,
    [SpanAttributes.TEMPLATE_NAME]: templateName,
  });

  try {
    const result = await operation();

    // If result contains mission ID, add it
    if (result && typeof result === 'object' && 'missionId' in result) {
      span.setAttribute(SpanAttributes.MISSION_ID, (result as Record<string, unknown>).missionId as string);
    }

    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordSpanError(span, error as Error, 'mission_creation_error');
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace API call with propagation headers
 */
export async function traceAPICall<T>(
  userId: string,
  tenantId: string,
  endpoint: string,
  method: string,
  operation: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  const span = createOnboardingSpan(
    `onboarding.api.${method.toLowerCase()}.${endpoint.replace(/\//g, '.')}`,
    userId,
    tenantId,
    SpanKind.CLIENT
  );

  span.setAttributes({
    'http.method': method,
    'http.url': endpoint,
  });

  try {
    // Inject trace context into headers for distributed tracing
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers);

    const result = await operation(headers);

    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordSpanError(span, error as Error, 'api_call_error');
    throw error;
  } finally {
    span.end();
  }
}

// ============================================================================
// React Hook for Tracing
// ============================================================================

import * as React from 'react';

export interface TracingContext {
  userId: string;
  tenantId: string;
}

/**
 * useOnboardingTracing Hook
 *
 * Provides tracing utilities for React components.
 */
export function useOnboardingTracing(ctx: TracingContext) {
  const { userId, tenantId } = ctx;

  const traceNavigation = React.useCallback(
    async <T,>(stepId: WizardStepId, stepIndex: number, operation: () => Promise<T>) => {
      return traceWizardNavigation(userId, tenantId, stepId, stepIndex, operation);
    },
    [userId, tenantId]
  );

  const traceLLM = React.useCallback(
    async <T,>(provider: LLMProvider, operation: () => Promise<T>) => {
      return traceLLMValidation(userId, tenantId, provider, operation);
    },
    [userId, tenantId]
  );

  const traceState = React.useCallback(
    async <T,>(
      operation: 'save' | 'load' | 'sync',
      storageType: 'redis' | 'localStorage' | 'hybrid',
      fn: () => Promise<T>
    ) => {
      return traceStatePersistence(userId, tenantId, operation, storageType, fn);
    },
    [userId, tenantId]
  );

  const traceMission = React.useCallback(
    async <T,>(templateId: string, templateName: string, operation: () => Promise<T>) => {
      return traceMissionCreation(userId, tenantId, templateId, templateName, operation);
    },
    [userId, tenantId]
  );

  const traceAPI = React.useCallback(
    async <T,>(
      endpoint: string,
      method: string,
      operation: (headers: Record<string, string>) => Promise<T>
    ) => {
      return traceAPICall(userId, tenantId, endpoint, method, operation);
    },
    [userId, tenantId]
  );

  return {
    traceNavigation,
    traceLLM,
    traceState,
    traceMission,
    traceAPI,
  };
}

// ============================================================================
// Server-Side Tracing Utilities
// ============================================================================

/**
 * Create server-side span for API route handlers
 */
export function createAPIRouteSpan(
  routeName: string,
  method: string,
  userId?: string,
  tenantId?: string
): Span {
  const tracer = getOnboardingTracer();
  const span = tracer.startSpan(`onboarding.api.${routeName}`, {
    kind: SpanKind.SERVER,
  });

  span.setAttributes({
    'http.method': method,
    'http.route': `/api/onboarding/${routeName}`,
  });

  if (userId) span.setAttribute(SpanAttributes.USER_ID, userId);
  if (tenantId) span.setAttribute(SpanAttributes.TENANT_ID, tenantId);

  return span;
}

/**
 * Wrap API route handler with tracing
 */
export function withTracing<T>(
  routeName: string,
  method: string,
  handler: (span: Span) => Promise<T>,
  userId?: string,
  tenantId?: string
): Promise<T> {
  const span = createAPIRouteSpan(routeName, method, userId, tenantId);

  return handler(span)
    .then((result) => {
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    })
    .catch((error) => {
      recordSpanError(span, error as Error);
      throw error;
    })
    .finally(() => {
      span.end();
    });
}

// ============================================================================
// Export
// ============================================================================

export default {
  getOnboardingTracer,
  createOnboardingSpan,
  addWizardContext,
  recordSpanError,
  traceWizardNavigation,
  traceLLMValidation,
  traceStatePersistence,
  traceMissionCreation,
  traceAPICall,
  useOnboardingTracing,
  createAPIRouteSpan,
  withTracing,
  SpanAttributes,
  SpanEvents,
};
