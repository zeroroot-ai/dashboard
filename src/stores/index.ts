/**
 * Zustand state stores
 * UI state, preferences, event buffer, connection status, layout
 */

// Layout store
export {
  useLayoutStore,
  useLayout,
  useEditMode,
  useWidgetActions,
} from './layout-store';
export type { LayoutState } from './layout-store';

// Alerts store
export {
  useAlertsStore,
  useAlerts,
  useDropdown,
  useToastQueue,
  useAlertActions,
  useDoNotDisturb,
} from './alerts-store';
export type { AlertsState } from './alerts-store';

// Analytics store
export {
  useAnalyticsStore,
  useKPIsData,
  useIsStale,
  useLastUpdate,
  useAnalyticsActions,
} from './analytics-store';
export type {
  AnalyticsState,
  WebSocketUpdate,
  WebSocketUpdateType,
  ChartDataCacheEntry,
} from './analytics-store';

// WebSocket store
export {
  useWebSocketStore,
  useConnectionState,
  useIsConnected,
  useLastConnectedAt,
  useRetryCount,
  useWebSocketActions,
  useWebSocketStatus,
} from './websocket-store';
export type { WebSocketState } from './websocket-store';

// Chat store
export {
  useChatStore,
  useActiveConversation,
  useChatMessages,
  useSelectedAgent,
  useChatGraphContext,
  useChatConnection,
} from './chat-store';
export type {
  ChatState,
  ChatAgent,
  GraphContext,
  Conversation,
  AgentStatus,
} from './chat-store';

// Graph view store, single source of truth for the knowledge-graph explorer.
export { useGraphViewStore, DEFAULT_DISPLAY } from './graph-view-store';
export type {
  GraphViewState,
  GraphLayoutMode,
  GraphDisplaySettings,
} from './graph-view-store';
