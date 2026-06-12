"use client";

/**
 * useMissionDefinition, React Query hook that fetches a single mission
 * definition by name from GET /api/missions/definitions/[name].
 *
 * The route deserializes the proto via `toJson` (protobuf JSON encoding), so
 * all Duration / Timestamp / enum fields arrive as JSON-safe primitives.
 *
 * M6, mission-author-experience (Closes #187).
 */

import { useQuery } from "@tanstack/react-query";

// -----------------------------------------------------------------------
// JSON-deserialized shape of MissionDefinition as returned by the API.
// Duration → string ("300s"), Timestamp → RFC3339 string, bigint → string,
// enum → string enum name (e.g. "NODE_TYPE_AGENT").
// -----------------------------------------------------------------------

export interface ConstraintsJson {
  maxDuration?: string;           // google.protobuf.Duration → "Xs"
  maxTokens?: string;             // int64 serialised as string
  maxCost?: number;
  maxFindings?: number;
  severityThreshold?: string;
  requireEvidence?: boolean;
  blockedTools?: string[];
  blockedDomains?: string[];
  maxTurnsPerAgent?: number;
  allowedTechniques?: string[];
  blockedTechniques?: string[];
  maxTokensPerCall?: number;
}

export interface RepositoryConfigJson {
  name?: string;
  url?: string;
  branch?: string;
  credentialName?: string;
  shallow?: boolean;
  dependsOn?: string[];
}

export interface WorkspaceSettingsJson {
  cleanupOnComplete?: boolean;
  useWorktrees?: boolean;
  lspEnabled?: boolean;
  lspTimeout?: string;      // Duration → "Xs"
  baseDirectory?: string;
}

export interface WorkspaceConfigJson {
  repositories?: RepositoryConfigJson[];
  settings?: WorkspaceSettingsJson;
}

export interface RetryPolicyJson {
  maxRetries?: number;
  backoffStrategy?: string;  // enum string
  initialDelay?: string;     // Duration
  maxDelay?: string;         // Duration
  multiplier?: number;
}

export interface DataPolicyJson {
  storeInput?: boolean;
  storeOutput?: boolean;
  retention?: string;        // Duration
  encryption?: boolean;
  accessControl?: string[];
}

export interface ReusePolicyJson {
  outputScope?: string;
  inputScope?: string;
  reuse?: string;
}

export interface AgentNodeConfigJson {
  agentName?: string;
  task?: { goal?: string; context?: string };
  maxTokensPerCall?: number;
}

export interface ToolNodeConfigJson {
  toolName?: string;
  input?: Record<string, string>;
  maxTokensPerCall?: number;
}

export interface PluginNodeConfigJson {
  pluginName?: string;
  method?: string;
  params?: Record<string, string>;
  maxTokensPerCall?: number;
}

export interface ConditionNodeConfigJson {
  expression?: string;
  trueBranch?: string[];
  falseBranch?: string[];
  language?: string;
}

export interface ParallelNodeConfigJson {
  subNodes?: MissionNodeJson[];
  maxConcurrency?: number;
}

export interface JoinNodeConfigJson {
  waitFor?: string[];
  strategy?: string;
  aggregator?: string;
}

export interface MissionNodeJson {
  id?: string;
  type?: string;             // NodeType enum string
  name?: string;
  description?: string;
  dependencies?: string[];
  timeout?: string;          // Duration
  retryPolicy?: RetryPolicyJson;
  dataPolicy?: DataPolicyJson;
  reusePolicy?: ReusePolicyJson;
  metadata?: Record<string, string>;
  // oneof config, at most one is set
  agentConfig?: AgentNodeConfigJson;
  toolConfig?: ToolNodeConfigJson;
  pluginConfig?: PluginNodeConfigJson;
  conditionConfig?: ConditionNodeConfigJson;
  parallelConfig?: ParallelNodeConfigJson;
  joinConfig?: JoinNodeConfigJson;
}

export interface MissionEdgeJson {
  from?: string;
  to?: string;
  condition?: string;
}

export interface MissionDefinitionJson {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  targetRef?: string;
  source?: string;
  installedAt?: string;      // Timestamp → RFC3339
  createdAt?: string;        // Timestamp → RFC3339
  nodes?: Record<string, MissionNodeJson>;
  edges?: MissionEdgeJson[];
  entryPoints?: string[];
  exitPoints?: string[];
  metadata?: Record<string, string>;
  workspace?: WorkspaceConfigJson;
  constraints?: ConstraintsJson;
}

// -----------------------------------------------------------------------
// Query key factory (co-located; the global queryKeys registry may be
// extended later but the definition detail is self-contained for M6).
// -----------------------------------------------------------------------

export const missionDefinitionQueryKey = (name: string) =>
  ["missionDefinitions", "detail", name] as const;

async function fetchMissionDefinition(name: string): Promise<MissionDefinitionJson> {
  const resp = await fetch(
    `/api/missions/definitions/${encodeURIComponent(name)}`,
    { cache: "no-store" },
  );
  if (!resp.ok) {
    if (resp.status === 404) throw new Error("Mission definition not found");
    throw new Error(`Failed to fetch mission definition: ${resp.statusText}`);
  }
  return resp.json();
}

export function useMissionDefinition(name: string | undefined) {
  return useQuery({
    queryKey: name ? missionDefinitionQueryKey(name) : (["missionDefinitions", "detail", ""] as const),
    queryFn: () => fetchMissionDefinition(name!),
    enabled: !!name,
    staleTime: 30_000,
  });
}
