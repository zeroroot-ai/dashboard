import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WidgetLayout, WidgetConfig, WidgetType, WidgetPosition } from '@/src/types/analytics';

/**
 * Layout state interface for dashboard widget management.
 *
 * This store manages:
 * - Widget layout configuration
 * - Edit mode state
 * - Layout modifications and persistence
 *
 * State is persisted to localStorage via Zustand persist middleware.
 */
export interface LayoutState {
  // Layout state
  layout: WidgetLayout;
  isEditMode: boolean;
  isDirty: boolean;
  originalLayout: WidgetLayout | null;

  // Actions
  setLayout: (layout: WidgetLayout) => void;
  enterEditMode: () => void;
  exitEditMode: (save: boolean) => void;
  moveWidget: (widgetId: string, position: WidgetPosition) => void;
  addWidget: (type: WidgetType) => void;
  removeWidget: (widgetId: string) => void;
}

/**
 * Default widget layout configuration
 */
const DEFAULT_LAYOUT: WidgetLayout = {
  cols: 12,
  rowHeight: 80,
  widgets: [
    {
      id: 'kpi-summary',
      type: 'kpi-summary' as WidgetType,
      position: { x: 0, y: 0, w: 12, h: 2 },
      visible: true,
    },
    {
      id: 'findings-chart',
      type: 'findings-chart' as WidgetType,
      position: { x: 0, y: 2, w: 8, h: 4 },
      visible: true,
    },
    {
      id: 'severity-distribution',
      type: 'severity-distribution' as WidgetType,
      position: { x: 8, y: 2, w: 4, h: 4 },
      visible: true,
    },
    {
      id: 'mission-heatmap',
      type: 'mission-heatmap' as WidgetType,
      position: { x: 0, y: 6, w: 6, h: 4 },
      visible: true,
    },
    {
      id: 'agent-performance',
      type: 'agent-performance' as WidgetType,
      position: { x: 6, y: 6, w: 6, h: 4 },
      visible: true,
    },
  ],
};

/**
 * Helper function to find the first available position for a new widget
 */
function findAvailablePosition(widgets: WidgetConfig[], cols: number): WidgetPosition {
  // Default widget size
  const defaultWidth = 4;
  const defaultHeight = 3;

  // Create a grid to track occupied spaces
  const maxY = Math.max(...widgets.map((w) => w.position.y + w.position.h), 0);
  const occupied = new Set<string>();

  widgets.forEach((widget) => {
    const { x, y, w, h } = widget.position;
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        occupied.add(`${col},${row}`);
      }
    }
  });

  // Find first available position
  for (let y = 0; y <= maxY + 5; y++) {
    for (let x = 0; x <= cols - defaultWidth; x++) {
      let canFit = true;
      for (let row = y; row < y + defaultHeight && canFit; row++) {
        for (let col = x; col < x + defaultWidth && canFit; col++) {
          if (occupied.has(`${col},${row}`)) {
            canFit = false;
          }
        }
      }
      if (canFit) {
        return { x, y, w: defaultWidth, h: defaultHeight };
      }
    }
  }

  // Fallback: place at bottom
  return { x: 0, y: maxY + 1, w: defaultWidth, h: defaultHeight };
}

/**
 * Layout store with localStorage persistence.
 *
 * Persisted fields:
 * - layout
 *
 * Non-persisted fields (reset on reload):
 * - isEditMode
 * - isDirty
 * - originalLayout
 */
export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      // Initial state
      layout: DEFAULT_LAYOUT,
      isEditMode: false,
      isDirty: false,
      originalLayout: null,

      // Set entire layout
      setLayout: (layout) => {
        set({ layout });
      },

      // Enter edit mode - save current layout as original
      enterEditMode: () => {
        const currentLayout = get().layout;
        set({
          isEditMode: true,
          originalLayout: JSON.parse(JSON.stringify(currentLayout)), // Deep clone
          isDirty: false,
        });
      },

      // Exit edit mode - optionally restore original layout
      exitEditMode: (save) => {
        if (!save) {
          const original = get().originalLayout;
          if (original) {
            set({
              layout: original,
              isEditMode: false,
              isDirty: false,
              originalLayout: null,
            });
            return;
          }
        }
        set({
          isEditMode: false,
          isDirty: false,
          originalLayout: null,
        });
      },

      // Move widget to new position
      moveWidget: (widgetId, position) => {
        const currentLayout = get().layout;
        const updatedWidgets = currentLayout.widgets.map((widget) =>
          widget.id === widgetId ? { ...widget, position } : widget
        );

        set({
          layout: {
            ...currentLayout,
            widgets: updatedWidgets,
          },
          isDirty: true,
        });
      },

      // Add new widget
      addWidget: (type) => {
        const currentLayout = get().layout;
        const newWidget: WidgetConfig = {
          id: `${type}-${Date.now()}`,
          type,
          position: findAvailablePosition(currentLayout.widgets, currentLayout.cols),
          visible: true,
        };

        set({
          layout: {
            ...currentLayout,
            widgets: [...currentLayout.widgets, newWidget],
          },
          isDirty: true,
        });
      },

      // Remove widget
      removeWidget: (widgetId) => {
        const currentLayout = get().layout;
        const updatedWidgets = currentLayout.widgets.filter((widget) => widget.id !== widgetId);

        set({
          layout: {
            ...currentLayout,
            widgets: updatedWidgets,
          },
          isDirty: true,
        });
      },
    }),
    {
      name: 'gibson-dashboard-layout',
      // Only persist layout
      partialize: (state) => ({
        layout: state.layout,
      }),
    }
  )
);

/**
 * Hook to get layout state
 */
export const useLayout = () => {
  const layout = useLayoutStore((state) => state.layout);
  const setLayout = useLayoutStore((state) => state.setLayout);
  return { layout, setLayout };
};

/**
 * Hook to get edit mode state
 */
export const useEditMode = () => {
  const isEditMode = useLayoutStore((state) => state.isEditMode);
  const isDirty = useLayoutStore((state) => state.isDirty);
  const enterEditMode = useLayoutStore((state) => state.enterEditMode);
  const exitEditMode = useLayoutStore((state) => state.exitEditMode);
  return { isEditMode, isDirty, enterEditMode, exitEditMode };
};

/**
 * Hook to get widget manipulation actions
 */
export const useWidgetActions = () => {
  const moveWidget = useLayoutStore((state) => state.moveWidget);
  const addWidget = useLayoutStore((state) => state.addWidget);
  const removeWidget = useLayoutStore((state) => state.removeWidget);
  return { moveWidget, addWidget, removeWidget };
};
