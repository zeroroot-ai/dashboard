import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Event } from "@/src/types";

/**
 * Graph settings for 3D visualization customization.
 *
 * Controls visual effects, animations, and performance options for the knowledge graph.
 */
export interface GraphSettings {
  /** Enable/disable all animations (dash animations, pulsing, particles) */
  animationsEnabled: boolean;
  /** Enable/disable particle effects along active edges */
  particlesEnabled: boolean;
  /** Particle density (0.1-1.0), affects number of particles rendered */
  particleDensity: number;
  /** Glow intensity for nodes and edges (0-1) */
  glowIntensity: number;
  /** Enable/disable edge glow effects */
  edgeGlowEnabled: boolean;
  /** Enable/disable clustering of mission_run nodes and their children */
  clusteringEnabled: boolean;
}

/**
 * UI state interface for Gibson Mission Control dashboard.
 *
 * This store manages:
 * - Layout state (sidebar, panels)
 * - User preferences (theme, graph layout, graph settings)
 * - Real-time event buffer
 * - Connection status
 *
 * State is persisted to localStorage via Zustand persist middleware.
 */
export interface UIState {
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Panels
  chatPanelOpen: boolean;
  setChatPanelOpen: (open: boolean) => void;
  contextPanelOpen: boolean;
  setContextPanelOpen: (open: boolean) => void;
  contextPanelActiveTab: "findings" | "missions" | "events";
  setContextPanelActiveTab: (tab: "findings" | "missions" | "events") => void;

  // Preferences
  graphLayout: "2d" | "3d" | "force";
  setGraphLayout: (layout: "2d" | "3d" | "force") => void;
  graphViewMode: "2d" | "3d";
  setGraphViewMode: (mode: "2d" | "3d") => void;
  missionsView: "table" | "kanban";
  setMissionsView: (view: "table" | "kanban") => void;

  // Graph Settings
  graphSettings: GraphSettings;
  setGraphSettings: (settings: Partial<GraphSettings>) => void;

  // Events
  eventBuffer: Event[];
  addEvent: (event: Event) => void;
  clearEvents: () => void;
  eventsPaused: boolean;
  setEventsPaused: (paused: boolean) => void;

  // Connection
  connectionStatus: "connected" | "connecting" | "disconnected";
  setConnectionStatus: (status: "connected" | "connecting" | "disconnected") => void;

  // CRT Effects
  crtEffectsEnabled: boolean;
  setCrtEffectsEnabled: (enabled: boolean) => void;
}

/**
 * UI state store with localStorage persistence.
 *
 * Persisted fields:
 * - sidebarCollapsed
 * - chatPanelOpen
 * - contextPanelOpen
 * - contextPanelActiveTab
 * - theme
 * - graphLayout
 * - graphViewMode
 * - missionsView
 * - graphSettings
 * - eventsPaused
 * - crtEffectsEnabled
 *
 * Non-persisted fields (reset on reload):
 * - eventBuffer
 * - connectionStatus
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Sidebar state
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Panel state
      chatPanelOpen: false,
      setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
      contextPanelOpen: false,
      setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
      contextPanelActiveTab: "findings",
      setContextPanelActiveTab: (tab) => set({ contextPanelActiveTab: tab }),

      // Graph layout preference (default: 2d force layout)
      graphLayout: "force",
      setGraphLayout: (layout) => set({ graphLayout: layout }),

      // Graph view mode (2D or 3D)
      graphViewMode: "3d",
      setGraphViewMode: (mode) => set({ graphViewMode: mode }),

      // Missions view preference (default: table)
      missionsView: "table",
      setMissionsView: (view) => set({ missionsView: view }),

      // Graph settings (visual effects and performance)
      graphSettings: {
        animationsEnabled: true,
        particlesEnabled: true,
        particleDensity: 0.5,
        glowIntensity: 0.7,
        edgeGlowEnabled: true,
        clusteringEnabled: true,
      },
      setGraphSettings: (settings) =>
        set((state) => ({
          graphSettings: { ...state.graphSettings, ...settings },
        })),

      // Event buffer (max 1000 events)
      eventBuffer: [],
      addEvent: (event) =>
        set((state) => ({
          eventBuffer: [event, ...state.eventBuffer].slice(0, 1000),
        })),
      clearEvents: () => set({ eventBuffer: [] }),
      eventsPaused: false,
      setEventsPaused: (paused) => set({ eventsPaused: paused }),

      // Connection status (starts as connecting)
      connectionStatus: "connecting",
      setConnectionStatus: (status) => set({ connectionStatus: status }),

      // CRT Effects (disabled by default for accessibility)
      crtEffectsEnabled: false,
      setCrtEffectsEnabled: (enabled) => set({ crtEffectsEnabled: enabled }),
    }),
    {
      name: "gibson-dashboard-ui",
      // Only persist specific fields
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        chatPanelOpen: state.chatPanelOpen,
        contextPanelOpen: state.contextPanelOpen,
        contextPanelActiveTab: state.contextPanelActiveTab,
        graphLayout: state.graphLayout,
        graphViewMode: state.graphViewMode,
        missionsView: state.missionsView,
        graphSettings: state.graphSettings,
        eventsPaused: state.eventsPaused,
        crtEffectsEnabled: state.crtEffectsEnabled,
      }),
    }
  )
);

/**
 * Hook to get sidebar state
 */
export const useSidebar = () => {
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const setCollapsed = useUIStore((state) => state.setSidebarCollapsed);
  return { collapsed, setCollapsed };
};

/**
 * Hook to get chat panel state
 */
export const useChatPanel = () => {
  const open = useUIStore((state) => state.chatPanelOpen);
  const setOpen = useUIStore((state) => state.setChatPanelOpen);
  return { open, setOpen };
};

/**
 * Hook to get context panel state
 */
export const useContextPanel = () => {
  const open = useUIStore((state) => state.contextPanelOpen);
  const setOpen = useUIStore((state) => state.setContextPanelOpen);
  const activeTab = useUIStore((state) => state.contextPanelActiveTab);
  const setActiveTab = useUIStore((state) => state.setContextPanelActiveTab);
  return { open, setOpen, activeTab, setActiveTab };
};

/**
 * Hook to get graph layout preference
 */
export const useGraphLayout = () => {
  const layout = useUIStore((state) => state.graphLayout);
  const setLayout = useUIStore((state) => state.setGraphLayout);
  return { layout, setLayout };
};

/**
 * Hook to get graph view mode (2D/3D)
 */
export const useGraphViewMode = () => {
  const viewMode = useUIStore((state) => state.graphViewMode);
  const setViewMode = useUIStore((state) => state.setGraphViewMode);
  return { viewMode, setViewMode };
};

/**
 * Hook to get event buffer state
 */
export const useEventBuffer = () => {
  const events = useUIStore((state) => state.eventBuffer);
  const addEvent = useUIStore((state) => state.addEvent);
  const clearEvents = useUIStore((state) => state.clearEvents);
  const paused = useUIStore((state) => state.eventsPaused);
  const setPaused = useUIStore((state) => state.setEventsPaused);
  return { events, addEvent, clearEvents, paused, setPaused };
};

/**
 * Hook to get connection status
 */
export const useConnectionStatus = () => {
  const status = useUIStore((state) => state.connectionStatus);
  const setStatus = useUIStore((state) => state.setConnectionStatus);
  return { status, setStatus };
};

/**
 * Hook to get CRT effects state
 */
export const useCrtEffects = () => {
  const enabled = useUIStore((state) => state.crtEffectsEnabled);
  const setEnabled = useUIStore((state) => state.setCrtEffectsEnabled);
  return { enabled, setEnabled };
};

/**
 * Hook to get graph settings state
 *
 * Controls visual effects and performance options for the 3D knowledge graph:
 * - animationsEnabled: Master toggle for all animations
 * - particlesEnabled: Enable particle effects along edges
 * - particleDensity: Control particle density (0.1-1.0)
 * - glowIntensity: Control glow strength (0-1)
 * - edgeGlowEnabled: Enable edge glow effects
 * - clusteringEnabled: Enable mission_run clustering
 */
export const useGraphSettings = () => {
  const settings = useUIStore((state) => state.graphSettings);
  const setSettings = useUIStore((state) => state.setGraphSettings);
  return { settings, setSettings };
};
