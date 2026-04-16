/**
 * Analytics Type Definitions
 * Types for dashboard home analytics features
 */

// ============================================================================
// KPI Types
// ============================================================================

export interface KPIData {
  totalMissions: {
    allTime: number;
    thisMonth: number;
    thisWeek: number;
  };
  activeMissions: number;
  missionSuccessRate: number; // 0-100 percentage
  averageMissionDuration: number; // seconds
  agentUtilization: {
    busy: number;
    idle: number;
    percentage: number; // 0-100 percentage
  };
  findingsSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  newFindingsTrend: {
    last24h: number;
    previous24h: number;
    changePercent: number; // positive = increase, negative = decrease
  };
  criticalFindingsAged: number; // critical findings older than 7 days
}

// ============================================================================
// Time Series Types
// ============================================================================

export interface TimeSeriesPoint {
  timestamp: string; // ISO 8601 format
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export type TimeRange = '24h' | '7d' | '30d' | '90d';

export interface FindingsOverTime {
  timeRange: TimeRange;
  data: TimeSeriesPoint[];
}

// ============================================================================
// Category & Distribution Types
// ============================================================================

export interface CategoryCount {
  category: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface SeverityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

// ============================================================================
// Mission Activity Types
// ============================================================================

export interface HeatmapCell {
  date: string; // YYYY-MM-DD format
  count: number; // number of missions on that day
  successRate: number; // 0-100 percentage
}

export interface MissionHeatmap {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  cells: HeatmapCell[];
}

// ============================================================================
// Agent Performance Types
// ============================================================================

export type AgentStatus = 'idle' | 'busy' | 'degraded' | 'unhealthy';

export interface AgentPerformance {
  agentId: string;
  agentName: string;
  totalExecutions: number;
  avgExecutionTime: number; // seconds
  successRate: number; // 0-100 percentage
  findingsPerExecution: number; // average
  status: AgentStatus;
}

// ============================================================================
// Alert Types
// ============================================================================

export type AlertType = 'finding' | 'mission' | 'agent' | 'system';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  relatedEntityId?: string;
  relatedEntityType?: 'mission' | 'agent' | 'finding';
  actionUrl?: string;
}

// ============================================================================
// Widget Configuration Types
// ============================================================================

export enum WidgetType {
  KPI_SUMMARY = 'kpi-summary',
  FINDINGS_CHART = 'findings-chart',
  MISSION_HEATMAP = 'mission-heatmap',
  AGENT_PERFORMANCE = 'agent-performance',
  SEVERITY_DISTRIBUTION = 'severity-distribution',
  CATEGORY_BREAKDOWN = 'category-breakdown',
  RECENT_ALERTS = 'recent-alerts',
  ACTIVE_MISSIONS = 'active-missions',
}

export interface WidgetPosition {
  x: number; // grid column
  y: number; // grid row
  w: number; // width in grid units
  h: number; // height in grid units
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  position: WidgetPosition;
  visible: boolean;
  settings?: Record<string, unknown>; // widget-specific settings
}

export interface WidgetLayout {
  widgets: WidgetConfig[];
  cols: number; // total grid columns
  rowHeight: number; // height of each row in pixels
}

export interface UserLayoutPreferences {
  userId: string;
  layout: WidgetLayout;
  updatedAt: Date;
}
