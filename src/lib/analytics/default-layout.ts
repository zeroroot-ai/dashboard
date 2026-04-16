/**
 * Default Layout Configuration
 * Default widget layout for dashboard home page
 */

import { WidgetType, type WidgetLayout } from '@/src/types/analytics';

/**
 * Default dashboard layout with optimized positioning
 *
 * Layout breakdown:
 * - Row 1: Enhanced KPIs (full width, 2 rows tall)
 * - Row 2: Findings Line Chart (8 cols) + Severity Chart (4 cols)
 * - Row 3: Mission Heatmap (6 cols) + Quick Actions (6 cols)
 * - Row 4: Agent Performance Table (full width)
 *
 * Responsive breakpoints:
 * - lg: 12 columns (desktop)
 * - md: 8 columns (tablet)
 * - sm: 4 columns (large mobile)
 * - xs: 2 columns (mobile)
 * - xxs: 1 column (very small mobile)
 */
export const DEFAULT_LAYOUT: WidgetLayout = {
  cols: 12,
  rowHeight: 80,
  widgets: [
    // Row 1: Enhanced KPIs - full width, prominent position
    {
      id: 'enhanced-kpis',
      type: WidgetType.KPI_SUMMARY,
      position: { x: 0, y: 0, w: 12, h: 2 },
      visible: true,
    },

    // Row 2: Charts side by side
    {
      id: 'findings-line-chart',
      type: WidgetType.FINDINGS_CHART,
      position: { x: 0, y: 2, w: 8, h: 3 },
      visible: true,
    },
    {
      id: 'findings-severity-chart',
      type: WidgetType.SEVERITY_DISTRIBUTION,
      position: { x: 8, y: 2, w: 4, h: 3 },
      visible: true,
    },

    // Row 3: Mission heatmap and quick actions
    {
      id: 'mission-heatmap',
      type: WidgetType.MISSION_HEATMAP,
      position: { x: 0, y: 5, w: 6, h: 3 },
      visible: true,
    },
    {
      id: 'quick-actions',
      type: WidgetType.CATEGORY_BREAKDOWN,
      position: { x: 6, y: 5, w: 6, h: 3 },
      visible: true,
    },

    // Row 4: Agent performance table - full width
    {
      id: 'agent-performance',
      type: WidgetType.AGENT_PERFORMANCE,
      position: { x: 0, y: 8, w: 12, h: 3 },
      visible: true,
    },
  ],
};

/**
 * Widget dimension presets for different widget types
 * Used when adding new widgets to determine default size
 */
export const WIDGET_PRESETS: Record<
  WidgetType,
  { w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number }
> = {
  [WidgetType.KPI_SUMMARY]: {
    w: 12,
    h: 2,
    minW: 6,
    minH: 2,
    maxW: 12,
    maxH: 3,
  },
  [WidgetType.FINDINGS_CHART]: {
    w: 8,
    h: 3,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 5,
  },
  [WidgetType.SEVERITY_DISTRIBUTION]: {
    w: 4,
    h: 3,
    minW: 3,
    minH: 3,
    maxW: 6,
    maxH: 4,
  },
  [WidgetType.CATEGORY_BREAKDOWN]: {
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 5,
  },
  [WidgetType.MISSION_HEATMAP]: {
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxW: 8,
    maxH: 4,
  },
  [WidgetType.AGENT_PERFORMANCE]: {
    w: 12,
    h: 3,
    minW: 6,
    minH: 3,
    maxW: 12,
    maxH: 5,
  },
  [WidgetType.RECENT_ALERTS]: {
    w: 4,
    h: 3,
    minW: 3,
    minH: 3,
    maxW: 6,
    maxH: 5,
  },
  [WidgetType.ACTIVE_MISSIONS]: {
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    maxW: 8,
    maxH: 5,
  },
};
