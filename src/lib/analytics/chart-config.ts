/**
 * Chart Configuration
 * Reusable Recharts configurations and theme for dark corporate design
 */

import type { FindingSeverity } from '@/src/types';

// ============================================================================
// Severity Color Palette
// ============================================================================

/**
 * HSL-based severity colors optimized for dark theme
 * Matches design system severity levels with appropriate contrast
 */
export const severityColors: Record<FindingSeverity, string> = {
  critical: 'hsl(0, 72%, 51%)',     // Red - #dc2626
  high: 'hsl(17, 88%, 48%)',        // Orange - #ea580c
  medium: 'hsl(43, 96%, 40%)',      // Amber - #ca8a04
  low: 'hsl(199, 89%, 48%)',        // Cyan - #0ea5e9
  info: 'hsl(220, 9%, 46%)',        // Gray - #6b7280
};

/**
 * Severity colors with opacity for fills, gradients, and overlays
 */
export const severityColorsWithOpacity: Record<FindingSeverity, string> = {
  critical: 'hsla(0, 72%, 51%, 0.8)',
  high: 'hsla(17, 88%, 48%, 0.8)',
  medium: 'hsla(43, 96%, 40%, 0.8)',
  low: 'hsla(199, 89%, 48%, 0.8)',
  info: 'hsla(220, 9%, 46%, 0.8)',
};

/**
 * Get severity color by severity level
 */
export function getSeverityColor(severity: FindingSeverity): string {
  return severityColors[severity];
}

// ============================================================================
// Chart Theme Configuration
// ============================================================================

/**
 * Dark theme configuration for all Recharts components
 * Provides consistent styling across all chart types
 */
export const chartTheme = {
  // Grid styling
  grid: {
    stroke: 'hsl(215, 20%, 25%)',      // --border
    strokeWidth: 1,
    strokeOpacity: 0.5,
    strokeDasharray: '3 3',
  },

  // Axis styling
  axis: {
    stroke: 'hsl(220, 9%, 46%)',       // --foreground-subtle
    strokeWidth: 1,
    tick: {
      fill: 'hsl(220, 13%, 64%)',      // --foreground-muted
      fontSize: 12,
      fontFamily: 'var(--font-sans)',
    },
    label: {
      fill: 'hsl(220, 13%, 64%)',      // --foreground-muted
      fontSize: 12,
      fontFamily: 'var(--font-sans)',
      fontWeight: 500,
    },
  },

  // Tooltip styling
  tooltip: {
    contentStyle: {
      backgroundColor: 'hsl(222, 14%, 11%)',  // --background-secondary
      border: '1px solid hsl(215, 20%, 25%)',  // --border
      borderRadius: '0.5rem',
      padding: '0.75rem',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    },
    labelStyle: {
      color: 'hsl(217, 19%, 90%)',      // --foreground
      fontSize: 12,
      fontWeight: 600,
      fontFamily: 'var(--font-sans)',
      marginBottom: '0.5rem',
    },
    itemStyle: {
      color: 'hsl(220, 13%, 64%)',      // --foreground-muted
      fontSize: 12,
      fontFamily: 'var(--font-sans)',
      padding: '0.125rem 0',
    },
    cursor: {
      stroke: 'hsl(217, 91%, 60%)',     // --primary
      strokeWidth: 2,
      strokeDasharray: '5 5',
      opacity: 0.5,
    },
  },

  // Legend styling
  legend: {
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: {
      fontSize: 12,
      fontFamily: 'var(--font-sans)',
      color: 'hsl(220, 13%, 64%)',      // --foreground-muted
    },
  },

  // Animation configuration
  animation: {
    duration: 750,
    easing: 'ease-in-out' as const,
  },
} as const;

// ============================================================================
// Recharts Component Props
// ============================================================================

/**
 * Common CartesianGrid props for consistent grid styling
 */
export const defaultGridProps = {
  stroke: chartTheme.grid.stroke,
  strokeWidth: chartTheme.grid.strokeWidth,
  strokeOpacity: chartTheme.grid.strokeOpacity,
  strokeDasharray: chartTheme.grid.strokeDasharray,
  vertical: false,
};

/**
 * Common XAxis props for consistent axis styling
 */
export const defaultXAxisProps = {
  stroke: chartTheme.axis.stroke,
  strokeWidth: chartTheme.axis.strokeWidth,
  tick: chartTheme.axis.tick,
  tickLine: false,
  axisLine: { strokeWidth: 1 },
};

/**
 * Common YAxis props for consistent axis styling
 */
export const defaultYAxisProps = {
  stroke: chartTheme.axis.stroke,
  strokeWidth: chartTheme.axis.strokeWidth,
  tick: chartTheme.axis.tick,
  tickLine: false,
  axisLine: { strokeWidth: 1 },
};

/**
 * Common Tooltip props for consistent tooltip styling
 */
export const defaultTooltipProps = {
  contentStyle: chartTheme.tooltip.contentStyle,
  labelStyle: chartTheme.tooltip.labelStyle,
  itemStyle: chartTheme.tooltip.itemStyle,
  cursor: chartTheme.tooltip.cursor,
};

/**
 * Common Legend props for consistent legend styling
 */
export const defaultLegendProps = {
  iconType: chartTheme.legend.iconType,
  iconSize: chartTheme.legend.iconSize,
  wrapperStyle: chartTheme.legend.wrapperStyle,
};

// ============================================================================
// Heatmap Configuration
// ============================================================================

/**
 * Color scale for mission activity heatmap
 * Gradient from dark to bright cyan based on intensity
 */
export const heatmapColorScale = [
  'hsl(222, 14%, 11%)',      // No activity - background-secondary
  'hsl(199, 89%, 15%)',      // Very low - dark cyan
  'hsl(199, 89%, 25%)',      // Low
  'hsl(199, 89%, 35%)',      // Medium-low
  'hsl(199, 89%, 48%)',      // Medium - cyan
  'hsl(199, 89%, 60%)',      // Medium-high
  'hsl(199, 89%, 70%)',      // High - bright cyan
  'hsl(199, 89%, 80%)',      // Very high
] as const;

/**
 * Get heatmap color based on value and max value
 * Returns color from scale based on intensity
 */
export function getHeatmapColor(value: number, maxValue: number): string {
  if (value === 0) return heatmapColorScale[0];

  const ratio = value / maxValue;
  const index = Math.min(
    Math.floor(ratio * (heatmapColorScale.length - 1)) + 1,
    heatmapColorScale.length - 1
  );

  return heatmapColorScale[index];
}

// ============================================================================
// Chart Responsive Configuration
// ============================================================================

/**
 * Default responsive container aspect ratio for different chart types
 */
export const chartAspectRatios = {
  line: 2.5,        // Wide aspect for time series
  pie: 1.5,         // Slightly wider for donut with legend
  bar: 1.8,         // Balanced aspect for horizontal bars
  heatmap: 0.6,     // Shorter for calendar view
} as const;

/**
 * Default chart margins for different positions
 */
export const chartMargins = {
  default: { top: 20, right: 30, bottom: 20, left: 20 },
  withLegend: { top: 20, right: 30, bottom: 40, left: 20 },
  withYAxisLabel: { top: 20, right: 30, bottom: 20, left: 60 },
} as const;
