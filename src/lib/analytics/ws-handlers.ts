/**
 * WebSocket Event Handlers
 * Processes WebSocket events and updates appropriate stores
 */

import { useAnalyticsStore } from '@/src/stores/analytics-store';
import { useAlertsStore } from '@/src/stores/alerts-store';
import type { Alert, FindingSeverity, KPIData } from '@/src/types';
import type { WebSocketMessage } from '@/src/hooks/useWebSocket';
import { logger } from '@/src/lib/logger';

// ============================================================================
// WebSocket Event Types
// ============================================================================

export interface MissionStatusEvent {
  type: 'mission_status';
  payload: {
    missionId: string;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
    progress?: number;
    previousStatus?: string;
    success?: boolean;
    completedAt?: string;
  };
}

export interface FindingCreatedEvent {
  type: 'finding_created';
  payload: {
    findingId: string;
    missionId: string;
    severity: FindingSeverity;
    title: string;
    category: string;
    timestamp: string;
  };
}

export interface AgentHealthEvent {
  type: 'agent_health';
  payload: {
    agentId: string;
    agentName: string;
    status: 'idle' | 'busy' | 'degraded' | 'unhealthy';
    previousStatus?: string;
    errorRate?: number;
    lastActivity?: string;
  };
}

export interface ComponentHealthEvent {
  type: 'component_health';
  payload: {
    componentId: string;
    componentName: string;
    componentType: 'agent' | 'tool' | 'plugin';
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    previousStatus?: string;
    errorRate?: number;
    resourceUtilization?: {
      cpu?: number;
      memory?: number;
    };
  };
}

export interface AlertNewEvent {
  type: 'alert_new';
  payload: Alert;
}

export interface KPIUpdateEvent {
  type: 'kpi_update';
  payload: Partial<KPIData>;
}

export type WebSocketEvent =
  | MissionStatusEvent
  | FindingCreatedEvent
  | AgentHealthEvent
  | ComponentHealthEvent
  | AlertNewEvent
  | KPIUpdateEvent;

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle mission status updates
 * Updates mission-related KPIs and widgets
 */
export function handleMissionStatus(event: MissionStatusEvent): void {
  const { payload } = event;
  const store = useAnalyticsStore.getState();

  // Apply real-time update to analytics store
  store.applyRealtimeUpdate({
    type: 'mission_status',
    timestamp: new Date().toISOString(),
    payload: {
      status: payload.status,
      completed: payload.status === 'completed' || payload.status === 'failed',
      success: payload.success,
    },
  });

  // Flush updates immediately for mission status changes
  store.flushPendingUpdates();

  logger.debug({ event: 'ws.mission.status', missionId: payload.missionId, status: payload.status }, 'mission status updated');
}

/**
 * Handle new finding created
 * Updates finding charts and triggers alerts for critical findings
 */
export function handleFindingCreated(event: FindingCreatedEvent): void {
  const { payload } = event;
  const analyticsStore = useAnalyticsStore.getState();
  const alertsStore = useAlertsStore.getState();

  // Apply real-time update to analytics store
  analyticsStore.applyRealtimeUpdate({
    type: 'finding_created',
    timestamp: payload.timestamp,
    payload: {
      severity: payload.severity,
    },
  });

  // Flush updates for findings
  analyticsStore.flushPendingUpdates();

  // Trigger alert for critical findings
  if (payload.severity === 'critical') {
    const alert: Alert = {
      id: `finding-${payload.findingId}`,
      type: 'finding',
      severity: 'critical',
      title: 'Critical Finding Detected',
      message: payload.title,
      timestamp: new Date(payload.timestamp),
      read: false,
      relatedEntityId: payload.findingId,
      relatedEntityType: 'finding',
      actionUrl: `/findings/${payload.findingId}`,
    };

    alertsStore.addAlert(alert);
  }

  logger.debug({ event: 'ws.finding.created', findingId: payload.findingId, missionId: payload.missionId, severity: payload.severity }, 'finding created');
}

/**
 * Handle agent health updates
 * Updates agent performance table and triggers alerts if degraded
 */
export function handleAgentHealth(event: AgentHealthEvent): void {
  const { payload } = event;
  const analyticsStore = useAnalyticsStore.getState();
  const alertsStore = useAlertsStore.getState();

  // Apply real-time update to analytics store
  analyticsStore.applyRealtimeUpdate({
    type: 'agent_health',
    timestamp: new Date().toISOString(),
    payload: {
      status: payload.status,
      previousStatus: payload.previousStatus,
    },
  });

  // Flush updates for agent health
  analyticsStore.flushPendingUpdates();

  // Trigger alert for degraded or unhealthy agents
  if (payload.status === 'degraded' || payload.status === 'unhealthy') {
    const severity = payload.status === 'unhealthy' ? 'critical' : 'warning';

    const alert: Alert = {
      id: `agent-${payload.agentId}-${Date.now()}`,
      type: 'agent',
      severity,
      title: `Agent ${payload.status === 'unhealthy' ? 'Unhealthy' : 'Degraded'}`,
      message: `Agent "${payload.agentName}" is ${payload.status}${
        payload.errorRate ? ` (error rate: ${(payload.errorRate * 100).toFixed(1)}%)` : ''
      }`,
      timestamp: new Date(),
      read: false,
      relatedEntityId: payload.agentId,
      relatedEntityType: 'agent',
      actionUrl: `/components/agents/${payload.agentId}`,
    };

    alertsStore.addAlert(alert);
  }

  logger.debug({ event: 'ws.agent.health', agentId: payload.agentId, agentName: payload.agentName, status: payload.status }, 'agent health updated');
}

/**
 * Handle component health updates
 * Updates health widgets and system status
 */
export function handleComponentHealth(event: ComponentHealthEvent): void {
  const { payload } = event;
  const analyticsStore = useAnalyticsStore.getState();
  const alertsStore = useAlertsStore.getState();

  // Apply real-time update to analytics store
  analyticsStore.applyRealtimeUpdate({
    type: 'component_health',
    timestamp: new Date().toISOString(),
    payload,
  });

  // Flush updates for component health
  analyticsStore.flushPendingUpdates();

  // Trigger alert for unhealthy components
  if (payload.status === 'unhealthy') {
    const alert: Alert = {
      id: `component-${payload.componentId}-${Date.now()}`,
      type: 'system',
      severity: 'critical',
      title: 'Component Unhealthy',
      message: `${payload.componentType} "${payload.componentName}" is unhealthy${
        payload.errorRate ? ` (error rate: ${(payload.errorRate * 100).toFixed(1)}%)` : ''
      }`,
      timestamp: new Date(),
      read: false,
      relatedEntityId: payload.componentId,
      relatedEntityType: undefined,
      actionUrl: `/components/${payload.componentType}s/${payload.componentId}`,
    };

    alertsStore.addAlert(alert);
  }

  logger.debug({ event: 'ws.component.health', componentId: payload.componentId, componentName: payload.componentName, status: payload.status }, 'component health updated');
}

/**
 * Handle new alert
 * Adds alert to alerts store
 */
export function handleAlertNew(event: AlertNewEvent): void {
  const { payload } = event;
  const alertsStore = useAlertsStore.getState();

  // Add alert to store
  alertsStore.addAlert(payload);

  logger.debug({ event: 'ws.alert.created', alertId: payload.id, type: payload.type, severity: payload.severity }, 'new alert received');
}

/**
 * Handle KPI update
 * Directly updates KPIs with partial data
 */
export function handleKPIUpdate(event: KPIUpdateEvent): void {
  const { payload } = event;
  const analyticsStore = useAnalyticsStore.getState();

  // Apply KPI update
  analyticsStore.applyRealtimeUpdate({
    type: 'kpi_update',
    timestamp: new Date().toISOString(),
    payload,
  });

  // Flush updates immediately for KPI changes
  analyticsStore.flushPendingUpdates();

  logger.debug({ event: 'ws.kpi.updated', keys: Object.keys(payload) }, 'KPI updated');
}

// ============================================================================
// Main Message Handler
// ============================================================================

/**
 * Main WebSocket message handler
 * Routes messages to appropriate handlers based on event type
 *
 * @param message WebSocket message from useWebSocket hook
 */
export function handleWebSocketMessage(message: WebSocketMessage): void {
  try {
    const event = message as unknown as WebSocketEvent;

    switch (event.type) {
      case 'mission_status':
        handleMissionStatus(event);
        break;

      case 'finding_created':
        handleFindingCreated(event);
        break;

      case 'agent_health':
        handleAgentHealth(event);
        break;

      case 'component_health':
        handleComponentHealth(event);
        break;

      case 'alert_new':
        handleAlertNew(event);
        break;

      case 'kpi_update':
        handleKPIUpdate(event);
        break;

      default: {
        // Capture type before TypeScript narrows to never at the exhausted switch end
        const unknownType = (event as { type?: string }).type;
        logger.warn({ event: 'ws.handler.unknown_type', messageType: unknownType }, 'received unknown WebSocket event type');
      }
    }
  } catch (error) {
    // Do NOT log the full message payload — it may contain finding titles,
    // agent names, or alert content. Log only a short type marker.
    const messageType =
      typeof message === 'object' && message !== null && 'type' in message
        ? (message as { type?: unknown }).type
        : 'unknown';
    logger.error({ event: 'ws.handler.error', messageType, err: error }, 'error processing WebSocket message');
  }
}
