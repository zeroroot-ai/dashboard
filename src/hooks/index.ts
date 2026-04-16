/**
 * Custom React hooks
 * React Query hooks, UI state hooks, real-time subscriptions
 */

// Component hooks
export {
  useAgents,
  useTools,
  usePlugins,
  useComponentCounts,
  useComponent,
  useComponentsByStatus,
} from "./useComponents";
export type { ComponentCounts, AllComponentCounts } from "./useComponents";

// Event stream hook
export { useEventStream } from "./useEventStream";

// Graph hooks
export {
  useMissionGraph,
  useFullGraph,
  useGraphStats,
  useGraph,
  extractRelationshipTypes,
  filterGraphData,
} from "./useGraph";
export type { GraphData, GraphFilterOptions, GraphStats } from "./useGraph";

// Graph highlight hook
export { useGraphHighlight } from "./useGraphHighlight";
export type {
  HighlightedNode,
  GraphHighlightState,
  UseGraphHighlightReturn,
} from "./useGraphHighlight";

// Chat hook
export { useChat } from "./useChat";
export type { UseChatOptions, SendMessageOptions } from "./useChat";

// Analytics hooks
export {
  useKPIs,
  useFindingsTimeSeries,
  useFindingsSeverity,
  useFindingsCategory,
  useMissionHeatmap,
  useAgentPerformance,
} from "./useAnalytics";

// Widget layout hooks
export {
  useLayoutQuery,
  useSaveLayout,
  useResetLayout,
} from "./useWidgetLayout";

// Alerts hooks
export {
  useAlerts,
  useMarkAsRead,
  useMarkAllAsRead,
} from "./useAlerts";

// WebSocket hooks
export {
  useWebSocket,
} from "./useWebSocket";
export type {
  ConnectionState,
  WebSocketMessage,
  UseWebSocketOptions,
  UseWebSocketReturn,
} from "./useWebSocket";
