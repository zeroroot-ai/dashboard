import 'server-only';
import { ConnectError, Code } from '@connectrpc/connect';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';
import { ProviderService } from '@/src/gen/gibson/tenant/v1/provider_pb';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import type {
  MissionInfo,
  AgentInfo,
  ToolInfo,
  PluginInfo,
  StatusResponse,
  Capabilities,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';
import type {
  UserProfile,
  UserActivity,
  ListUserActivitiesResponse,
} from '@/src/types/user';
import type {
  CredentialFieldDescriptor,
  ModelDescriptor,
  SupportedProviderDescriptor,
  DaemonProviderConfigInput,
  ProviderCapability,
} from './gibson-client-types';
// Re-exported for back-compat; client components should import from
// gibson-client-types directly to avoid pulling grpc-js into the browser bundle.
export type {
  SupportedProviderDescriptor,
  DaemonProviderConfigInput,
  ProviderCapability,
};
import {
  fromProtoCapabilities,
  toProtoCapabilities,
} from './provider-capabilities';
import { requireUserToken } from './auth/user-token';
// The ConnectRPC transport now lives in the module-private
// `gibson-client/transport.ts` (dashboard#814). `makeClient` and the raw
// `createGrpcTransport` / `createClient` primitives are intentionally NOT
// re-exported, this file consumes the sanctioned typed-client wrappers only.
import { userClient, serviceClient } from './gibson-client/transport';
export { userClient, serviceClient };

// Tenant CRUD has moved to the daemon's AdminTenantService (operator-pull,
// gibson#964); see `@/app/actions/crd/tenant.ts`. Tenant proto types are no
// longer exported by this module. The dashboard holds zero Kubernetes access
// (dashboard#855).

// ---------------------------------------------------------------------------
// Internal user-acting client builders, these preserve the signatures of
// the old `getClient` / `getAdminClient` so the dozens of helper functions
// further down this file keep working unchanged. New code should call
// `userClient(...)` directly.
// ---------------------------------------------------------------------------

async function getClient(_userId?: string, _tenantId?: string) {
  // Fail closed before constructing the client: the user-acting path
  // requires a valid session even though the actual token resolution
  // happens inside the interceptor. Pre-checks catch "obviously
  // unauthenticated" calls without paying for transport setup.
  await requireUserToken();
  return userClient(DaemonService);
}

async function getAdminClient(_userId?: string, _tenantId?: string) {
  await requireUserToken();
  return userClient(ProviderService);
}

async function getUserServiceClient(_userId?: string, _tenantId?: string) {
  await requireUserToken();
  return userClient(UserService);
}

async function getTenantServiceClient(_userId?: string, _tenantId?: string) {
  await requireUserToken();
  return userClient(TenantService);
}

// ---------------------------------------------------------------------------
// LLM user-attribution-governance clients (spec: llm-user-attribution-governance)
// ---------------------------------------------------------------------------

export async function getBudgetClient() {
  await requireUserToken();
  const { BudgetService } = await import('@/src/gen/gibson/tenant/v1/budget_pb');
  return userClient(BudgetService);
}

export async function getModelAccessClient() {
  await requireUserToken();
  const { ModelAccessService } = await import(
    '@/src/gen/gibson/tenant/v1/model_access_pb'
  );
  return userClient(ModelAccessService);
}

export async function getUsageClient() {
  await requireUserToken();
  const { UsageService } = await import('@/src/gen/gibson/tenant/v1/usage_pb');
  return userClient(UsageService);
}

export async function getStatus(userId?: string, tenantId?: string): Promise<StatusResponse> {
  const client = await getClient(userId, tenantId);
  const response = await client.status({});
  return response;
}

export async function ping(userId?: string, tenantId?: string): Promise<{ timestamp: bigint }> {
  const client = await getClient(userId, tenantId);
  const response = await client.ping({});
  return response;
}

export async function listMissions(activeOnly = false, limit = 100, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.listMissions({
    activeOnly,
    limit,
  });
  return response;
}

export async function listAgents(kind?: string, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.listAgents({
    kind: kind || '',
  });
  return response;
}

export async function listTools(userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.listTools({});
  return response;
}

export async function listPlugins(userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.listPlugins({});
  return response;
}

export async function stopMission(missionId: string, force = false, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.stopMission({
    missionId,
    force,
  });
  return response;
}

export async function pauseMission(missionId: string, force = false, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.pauseMission({
    missionId,
    force,
  });
  return response;
}

export async function resumeMission(missionId: string, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  // ResumeMission returns a stream, but we just need to initiate it
  // The stream will emit events as the mission progresses
  const stream = client.resumeMission({
    missionId,
  });
  // Consume the first event to confirm the mission resumed
  for await (const event of stream) {
    // Return after first event to confirm resume started
    return { success: true, event };
  }
  return { success: true };
}

export async function runMission(
  missionDefinitionId: string,
  targetId: string,
  variables: Record<string, string> = {},
  memoryContinuity = 'isolated',
  userId?: string,
  tenantId?: string
) {
  const client = await getClient(userId, tenantId);
  // RunMission returns a stream. The dashboard route is unary: open the
  // stream, read the first event to confirm dispatch, then return. The
  // detail page's /events SSE subscription picks up subsequent frames
  // (mission_started, tool_started, tool_completed, mission_completed).
  const stream = client.runMission({
    missionDefinitionId,
    targetId,
    variables,
    memoryContinuity,
  });
  for await (const event of stream) {
    return { success: true, missionId: event.missionId, event };
  }
  return { success: true };
}

async function getMissionHistory(name: string, limit = 100, offset = 0, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.getMissionHistory({
    name,
    limit,
    offset,
  });
  return response;
}

export async function listMissionDefinitions(userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.listMissionDefinitions({});
  return response;
}

export async function getMissionDefinition(name: string, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
  const response = await client.getMissionDefinition({ name });
  return response;
}

// Per-tenant Langfuse credential RPCs were removed from the
// gibson.tenant.v1.ProviderService proto when the tenant-admin surface was
// re-homed into the gibson daemon-local tree (E6, gibson#921). The dashboard
// wrappers had no callers, so they are dropped here rather than carried as
// dead code referencing message types the regenerated bindings no longer
// expose.

export { ConnectError, Code };

// ============================================================================
// Tenant Management API
// ============================================================================

// TenantUpdates removed, tenant mutation moved to the Tenant CRD operator.

interface AuditLogQueryOptions {
  startTime?: Date;
  endTime?: Date;
  action?: string;
  limit?: number;
}

interface AuditLogEntry {
  id: string;
  tenantId: string;
  action: string;
  actorSubject: string;
  actorEmail: string;
  resourceKind: string;
  resourceId: string;
  timestamp: string;
  metadata: Record<string, string>;
}

interface TenantQuota {
  tenantId: string;
  maxMissions: number;
  maxAgents: number;
  maxMembers: number;
  rateLimitRpm: number;
}

interface ProvisioningStep {
  name: string;
  status: string;
  message: string;
}

// listTenants / getTenant / updateTenant removed, tenant CRUD now flows
// through the daemon's AdminTenantService (operator-pull, gibson#964);
// see `app/actions/crd/tenant.ts` for the admin mutations.

// createAPIKey / listAPIKeys / revokeAPIKey removed, the gsk_ API key
// system has been removed. Agent identity provisioning now goes through
// TenantAdminService.CreateAgentIdentity (spec: agent-service-credentials).

// listUserTenants / MembershipInfo removed, tenant membership is now
// served by the daemon's MembershipService (ADR-0043/0044).

// getAuthSchema / getProvisioningStatus / deprovisionTenant removed -
// auth schema is now served by the FGA-backed GetMyPermissions RPC, and
// provisioning lifecycle moved to the Tenant CRD operator.

// ============================================================================
// Audit Log, ListAuditEvents RPC (DEFERRED, admin-services-completion spec)
// ============================================================================
// ListAuditEvents has been deferred per design.md disposition table.
// Dashboard call sites that previously called queryAuditLog now return empty
// results to avoid hitting the Unimplemented stub.

// ============================================================================
// Quota Management, GetTenantQuota RPC (TenantAdminService)
// ============================================================================

/**
 * Retrieve the resource quota (limits) for a tenant via
 * TenantAdminService.GetTenantQuota. Spec
 * plans-and-quotas-simplification reduces the response to two enforced
 * quotas; legacy maxMembers / rateLimitRpm fields are kept in the
 * dashboard's TenantQuota shape for backward compatibility but always 0.
 */
async function getTenantQuota(
  tenantId: string,
  targetTenantId: string,
  userId?: string
): Promise<TenantQuota> {
  const client = await getTenantServiceClient(userId, tenantId);
  const response = await client.getTenantQuota({ tenantId: targetTenantId });
  return {
    tenantId: targetTenantId,
    maxMissions: response.concurrentMissions ?? 0,
    maxAgents: response.concurrentAgents ?? 0,
    maxMembers: 0,
    rateLimitRpm: 0,
  };
}

/**
 * Retrieve the live counter values (current usage) for a tenant via
 * TenantAdminService.GetTenantQuotaUsage. Cheap (single Redis MGET on
 * the daemon side); no caching here. Spec plans-and-quotas-simplification
 * R9.B.
 */
export async function getTenantQuotaUsage(
  tenantId: string,
  targetTenantId: string,
  userId?: string
): Promise<{ missionsActive: number; agentsActive: number }> {
  const client = await getTenantServiceClient(userId, tenantId);
  const response = await client.getTenantQuotaUsage({ tenantId: targetTenantId });
  return {
    missionsActive: Number(response.missionsActive ?? 0),
    agentsActive: Number(response.agentsActive ?? 0),
  };
}

// setTenantQuota removed, DEFERRED per admin-services-completion design.md.
// SetTenantQuota moved to PlatformOperatorService (platform-operator only; tenants
// do not set their own quotas). Dashboard call site deleted per task 19.

// ============================================================================
// Alert Management, DEFERRED per admin-services-completion spec
// ============================================================================
// ListAlerts / MarkAlertRead / MarkAllAlertsRead have been deferred.
// No alert producer exists today; the daemon stubs return Unimplemented.
// Route handlers that previously called these functions now return empty
// responses so the dashboard degrades gracefully without hitting Unimplemented.
//
// These exports are retained as no-ops so any reference to them compiles;
// route files are updated to not call the daemon at all.

interface AlertRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  severity: string;
  read: boolean;
  createdAt: string;
  source: string;
  sourceId: string;
}

// listAlerts removed, DEFER per design.md. Call site in /api/alerts/route.ts returns empty.
// markAlertRead removed, DEFER per design.md. Call site in /api/alerts/[id]/read/route.ts returns ok.
// markAllAlertsRead removed, DEFER per design.md. Call site in /api/alerts/mark-all-read/route.ts returns ok.

// ============================================================================
// Conversation History, UserService RPCs (spec: chat-conversation-persistence)
// ============================================================================

import type { MessagePart } from '@/src/gen/gibson/tenant/v1/user_pb';

export interface ConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * A single message as returned by `getConversation`.
 * Parts carry the lossless ordered content, the canonical shape since
 * dashboard#550 replaced the flat `content` string.
 */
interface ConversationMessageRecord {
  id: string;
  role: string;
  /** Ordered proto parts, the lossless representation. */
  parts: MessagePart[];
  createdAt: string;
}

export async function listConversations(limit = 50, userId = '', tenantId = ''): Promise<ConversationRecord[]> {
  const client = await getUserServiceClient();
  const resp = await client.listConversations({ tenantId, userId, limit });
  return (resp.conversations ?? []).map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    userId: c.userId,
    title: c.title,
    createdAt: c.createdAtUnix ? new Date(Number(c.createdAtUnix) * 1000).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAtUnix ? new Date(Number(c.updatedAtUnix) * 1000).toISOString() : new Date().toISOString(),
    messageCount: c.messageCount,
  }));
}

export async function getConversation(conversationId: string, userId = '', tenantId = ''): Promise<{ conversation: ConversationRecord; messages: ConversationMessageRecord[] }> {
  const client = await getUserServiceClient();
  const resp = await client.getConversation({ conversationId, tenantId });
  const c = resp.conversation;
  if (!c) {
    throw new ConnectError(`Conversation '${conversationId}' not found`, Code.NotFound);
  }
  return {
    conversation: {
      id: c.id,
      tenantId: c.tenantId,
      userId: c.userId,
      title: c.title,
      createdAt: c.createdAtUnix ? new Date(Number(c.createdAtUnix) * 1000).toISOString() : new Date().toISOString(),
      updatedAt: c.updatedAtUnix ? new Date(Number(c.updatedAtUnix) * 1000).toISOString() : new Date().toISOString(),
      messageCount: c.messageCount,
    },
    // Pass through the proto parts array directly, the normalizer converts
    // them to UIMessages on the load path (protoToUiMessages in message-normalizer.ts).
    messages: (resp.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAtUnix ? new Date(Number(m.createdAtUnix) * 1000).toISOString() : new Date().toISOString(),
    })),
  };
}

/**
 * Persist a conversation via the daemon SaveConversation RPC.
 *
 * `messages` must be the output of `uiMessagesToProto()` from
 * `src/lib/chat/message-normalizer.ts`, the normalizer is the single
 * source of truth for the UIMessage ↔ proto parts mapping.
 */
export async function saveConversation(
  conversationId: string,
  title: string,
  messages: { id: string; role: string; parts: MessagePart[]; createdAtUnix?: bigint }[],
  agentId = '',
): Promise<void> {
  const client = await getUserServiceClient();
  await client.saveConversation({
    conversationId,
    title,
    agentId,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAtUnix: m.createdAtUnix ?? BigInt(Math.floor(Date.now() / 1000)),
    })),
  });
}

/**
 * Rename a conversation via the daemon RenameConversation RPC.
 *
 * `tenantId` may be empty, the daemon resolves it from the authenticated
 * identity when empty. Returns void on success; throws a ConnectError on
 * failure so callers can revert optimistic updates.
 */
export async function renameConversation(
  conversationId: string,
  title: string,
  tenantId = '',
): Promise<void> {
  const client = await getUserServiceClient();
  await client.renameConversation({ tenantId, conversationId, title });
}

/**
 * Delete a conversation via the daemon DeleteConversation RPC.
 *
 * `tenantId` may be empty, the daemon resolves it from the authenticated
 * identity when empty. Returns void on success; throws a ConnectError on
 * failure so callers can revert optimistic updates.
 *
 * NOTE: The RPC has no `user_id` field, the daemon resolves the caller from
 * the authenticated identity and only allows deletion of their own conversations.
 */
export async function deleteConversation(
  conversationId: string,
  tenantId = '',
): Promise<void> {
  const client = await getUserServiceClient();
  await client.deleteConversation({ tenantId, conversationId });
}

// ============================================================================
// Serialization Helpers
// Convert proto message objects (with BigInt timestamps) to plain JS objects
// ============================================================================

/** Serialized form of a MissionInfo proto message. */
interface SerializedMission {
  id: string;
  name: string;
  /** Plain status string from the proto (e.g. "running", "completed", "failed"). */
  status: string;
  /**
   * Mission start time as Unix epoch seconds (`number`), or `null` when the
   * proto field is zero (unset).  Callers that need a `Date` should multiply
   * by 1000: `new Date(startTime * 1000)`.
   */
  startTime: number | null;
  /** Mission end time as Unix epoch seconds, or `null` when still running. */
  endTime: number | null;
  /** Number of findings discovered so far. */
  findingCount: number;
  /** Completion fraction in [0.0, 1.0]. Multiply by 100 for a percentage. */
  progress: number;
  /** Human-readable mission description. */
  description: string;
  /** The mission definition this mission was launched from, or `undefined` when unset. */
  missionDefinitionId?: string;
}

/** Serialized form of an AgentInfo proto message. */
interface SerializedAgent {
  id: string;
  name: string;
  /** Component kind, always `"agent"` for agents. */
  kind: string;
  version: string;
  /** gRPC endpoint address of the agent. */
  endpoint: string;
  /** List of declared capability strings (e.g. `["recon", "exploit"]`). */
  capabilities: string[];
  /** Health status string (e.g. `"healthy"`, `"unhealthy"`). */
  health: string;
  /**
   * Last heartbeat time as Unix epoch seconds (`number`), or `null` when the
   * proto field is zero (unset).
   */
  lastSeen: number | null;
}

/** Serialized form of a ToolInfo.capabilities nested message. */
interface SerializedCapabilities {
  /** Whether the tool process is running as uid 0 (root). */
  hasRoot: boolean;
  /** Whether passwordless sudo access is available. */
  hasSudo: boolean;
  /** Whether the tool can create raw network sockets. */
  canRawSocket: boolean;
  /** Tool-specific feature availability flags (proto map&lt;string, bool&gt;). */
  features: Record<string, boolean>;
  /** Command-line arguments the tool refuses to accept. */
  blockedArgs: string[];
  /** Mapping of blocked arguments to their recommended safe alternatives. */
  argAlternatives: Record<string, string>;
}

/** Serialized form of a ToolInfo proto message. */
interface SerializedTool {
  id: string;
  name: string;
  version: string;
  /** gRPC endpoint address of the tool. */
  endpoint: string;
  description: string;
  /** Health status string (e.g. `"healthy"`, `"unhealthy"`). */
  health: string;
  /**
   * Last heartbeat time as Unix epoch seconds (`number`), or `null` when the
   * proto field is zero (unset).
   */
  lastSeen: number | null;
  /**
   * Optional runtime privilege and feature descriptor.  Present only when the
   * tool reports capability information; `null` otherwise.
   */
  capabilities: SerializedCapabilities | null;
}

/** Serialized form of a PluginInfo proto message. */
interface SerializedPlugin {
  id: string;
  name: string;
  version: string;
  /** gRPC endpoint address of the plugin. */
  endpoint: string;
  description: string;
  /** Health status string (e.g. `"healthy"`, `"unhealthy"`). */
  health: string;
  /**
   * Last heartbeat time as Unix epoch seconds (`number`), or `null` when the
   * proto field is zero (unset).
   */
  lastSeen: number | null;
}

/** Serialized form of a StatusResponse proto message. */
interface SerializedStatus {
  /** Always `true` when the daemon is responding. */
  running: boolean;
  /** Operating-system PID of the daemon process. */
  pid: number;
  /**
   * Daemon start time as Unix epoch seconds (`number`), or `null` when the
   * proto field is zero (unset).
   */
  startTime: number | null;
  /** Human-readable uptime string (e.g. `"2h34m"`). */
  uptime: string;
  grpcAddress: string;
  registryType: string;
  registryAddr: string;
  callbackAddr: string;
  agentCount: number;
  missionCount: number;
  activeMissionCount: number;
}

/**
 * Convert a proto `google.protobuf.Timestamp`-shaped object, one that has a
 * `seconds` BigInt field and a `nanos` number field, to an ISO 8601 string.
 *
 * This helper is intended for proto messages that embed actual
 * `google.protobuf.Timestamp` fields.  The daemon's `int64` Unix-epoch fields
 * (e.g. `start_time`, `last_seen`) are raw scalar integers, not Timestamp
 * messages; those are exposed through the `number | null` fields on the
 * `SerializedMission` / `SerializedAgent` / etc. interfaces instead.
 *
 * Returns `null` when `ts` is `undefined` or `null` so callers can distinguish
 * "field not set" from a real timestamp.
 */
export function timestampToISO(ts: { seconds: bigint; nanos: number } | undefined | null): string | null {
  if (ts == null) return null;
  // seconds is BigInt, convert to ms and fold in the sub-second nanos portion.
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms).toISOString();
}

/**
 * Convert a raw `int64` Unix epoch seconds BigInt field from the daemon proto
 * to a plain JS `number`.
 *
 * Returns `null` when the value is `0n`, the proto default, which signals
 * "field not set" for optional timestamp fields in the daemon schema.
 *
 * The BigInt is always within the safe integer range for daemon timestamps
 * (Number.MAX_SAFE_INTEGER covers dates up to the year 285,428,751), so
 * `Number()` conversion is lossless.
 */
function bigintUnixToNumber(seconds: bigint): number | null {
  return seconds === BigInt(0) ? null : Number(seconds);
}

/**
 * Serialize the optional `Capabilities` nested message from a `ToolInfo`
 * proto into a plain JSON-safe object.
 *
 * The proto `map<string, bool>` and `map<string, string>` fields are already
 * plain JS objects in the Connect-ES runtime; they are spread into new objects
 * here so the returned value has no live references to the proto message.
 */
function serializeCapabilities(c: Capabilities | undefined): SerializedCapabilities | null {
  if (c == null) return null;
  return {
    hasRoot: c.hasRoot,
    hasSudo: c.hasSudo,
    canRawSocket: c.canRawSocket,
    features: { ...c.features },
    blockedArgs: [...c.blockedArgs],
    argAlternatives: { ...c.argAlternatives },
  };
}

/**
 * Serialize a `MissionInfo` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `startTime` / `endTime`: `int64` BigInt Unix seconds → `number | null`
 *   (`null` when the proto default `0` indicates the field is not set).
 * - `status`: plain string (e.g. `"running"`, `"completed"`, `"failed"`).
 * - `progress`: `double` in [0.0, 1.0], multiply by 100 for a percentage.
 * - String fields carry the proto zero value (`''`) when unset.
 */
export function serializeMission(m: MissionInfo): SerializedMission {
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    startTime: bigintUnixToNumber(m.startTime),
    endTime: bigintUnixToNumber(m.endTime),
    findingCount: m.findingCount,
    progress: m.progress,
    description: m.description,
    missionDefinitionId: m.missionDefinitionId || undefined,
  };
}

/**
 * Serialize an `AgentInfo` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `capabilities`: repeated string field, copied into a fresh array so the
 *   returned object holds no live references to the proto message.
 * - `lastSeen`: `int64` BigInt Unix seconds → `number | null`.
 */
export function serializeAgent(a: AgentInfo): SerializedAgent {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    version: a.version,
    endpoint: a.endpoint,
    capabilities: [...a.capabilities],
    health: a.health,
    lastSeen: bigintUnixToNumber(a.lastSeen),
  };
}

/**
 * Serialize a `ToolInfo` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `lastSeen`: `int64` BigInt Unix seconds → `number | null`.
 * - `capabilities`: optional nested `Capabilities` message serialized to a
 *   typed `SerializedCapabilities` object (or `null` when absent).  The
 *   nested object includes `hasRoot`, `hasSudo`, `canRawSocket`, the
 *   `features` map, the `blockedArgs` array, and the `argAlternatives` map.
 */
export function serializeTool(t: ToolInfo): SerializedTool {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    endpoint: t.endpoint,
    description: t.description,
    health: t.health,
    lastSeen: bigintUnixToNumber(t.lastSeen),
    capabilities: serializeCapabilities(t.capabilities),
  };
}

/**
 * Serialize a `PluginInfo` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `lastSeen`: `int64` BigInt Unix seconds → `number | null`.
 */
export function serializePlugin(p: PluginInfo): SerializedPlugin {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    endpoint: p.endpoint,
    description: p.description,
    health: p.health,
    lastSeen: bigintUnixToNumber(p.lastSeen),
  };
}

/**
 * Serialize a `StatusResponse` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `startTime`: `int64` BigInt Unix seconds → `number | null`.
 * - All `int32` counter fields (`pid`, `agentCount`, etc.) are used directly
 *   as JS numbers, they are always within `Number.MAX_SAFE_INTEGER`.
 */
export function serializeStatus(s: StatusResponse): SerializedStatus {
  return {
    running: s.running,
    pid: s.pid,
    startTime: bigintUnixToNumber(s.startTime),
    uptime: s.uptime,
    grpcAddress: s.grpcAddress,
    registryType: s.registryType,
    registryAddr: s.registryAddr,
    callbackAddr: s.callbackAddr,
    agentCount: s.agentCount,
    missionCount: s.missionCount,
    activeMissionCount: s.activeMissionCount,
  };
}

// ============================================================================
// Provider Management, thin wrappers over the daemon gRPC client
//
// spec 25-daemon-driven-provider-config (task 15): the legacy K8s Secret
// storage layer (provider-storage.ts) has been deleted. Every provider
// operation now routes through the TenantAdminService RPCs (migrated from
// DaemonAdminService per admin-services-completion spec). The exported
// function signatures are preserved so existing callers keep working without
// changes.
//
// The daemon* prefixed functions added in task 9 remain as the canonical
// implementations, they are called directly by the task-11 route handlers,
// the task-10 GibsonLLMAdapter, and the thin wrappers below.
// ============================================================================

/**
 * Legacy-compatible read shape for a provider record.
 * @deprecated Prefer {@link DaemonProviderRecord} for new code.
 */
interface ProviderRecord {
  name: string;
  displayName: string;
  type: string;
  apiKeyMasked?: string;
  baseUrl?: string;
  defaultModel?: string;
  isDefault: boolean;
  isEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  health?: { status: string; latencyMs?: number; lastCheckAt?: string; lastSuccessAt?: string };
  credentialsMasked?: Record<string, string>;
}

/**
 * Result shape returned by {@link listProviders}.
 * `defaultProvider` is the name of the tenant's current default, or null.
 */
interface ListProvidersResult {
  providers: ProviderRecord[];
  defaultProvider: string | null;
}

/**
 * List all LLM provider configurations for a tenant.
 *
 * Thin wrapper over {@link daemonListProviders}.
 * Credentials are never returned, only masked values are included.
 */
export async function listProviders(tenantId: string, userId?: string): Promise<ListProvidersResult> {
  const records = await daemonListProviders(userId, tenantId);

  const providers: ProviderRecord[] = records.map((r) => ({
    name: r.name,
    displayName: r.name,
    type: r.type,
    defaultModel: r.defaultModel,
    isDefault: r.isDefault,
    isEnabled: r.enabled,
    version: 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    credentialsMasked: r.credentialsMasked,
  }));

  const defaultProvider = records.find((r) => r.isDefault)?.name ?? null;

  return { providers, defaultProvider };
}

// ============================================================================
// Plugin Management
//
// Enabled/disabled state, per-plugin config, and access flags are stored as
// string entries in the tenant config map managed by the Gibson daemon.
// Key conventions:
//   plugin_<name>_enabled  → "true" | "false"
//   plugin_<name>_config   → JSON string of Record<string,string>
//   plugin_<name>_access   → JSON string of { readEnabled, writeEnabled }
// testPluginConnection probes health via the daemon QueryPlugin RPC.
// ============================================================================

/**
 * Return all plugins known to the daemon for this tenant.
 * Direct alias for the existing `listPlugins` call.
 */
async function listAvailablePlugins(tenantId: string, userId?: string, tenantCtx?: string): Promise<PluginInfo[]> {
  const response = await listPlugins(userId, tenantCtx);
  return response.plugins ?? [];
}

// listTenantPlugins / enable*/disable* / get*/updatePluginConfig removed -
// these previously stored per-tenant flags inside the daemon's tenant config
// map. Tenant config is now owned by the Tenant CRD; equivalent flag/config
// management lives in `app/actions/crd/tenant.ts`.

/**
 * Probe plugin health via the daemon QueryPlugin RPC (method="health").
 *
 * Returns `{ success: true, latencyMs }` on success, or
 * `{ success: false, error, latencyMs }` on any failure without throwing.
 */
async function testPluginConnection(
  tenantId: string,
  name: string,
  _config?: Record<string, string>,
  userId?: string
): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
  const client = await getClient(userId, tenantId);
  const start = Date.now();
  try {
    const response = await client.queryPlugin({
      name,
      method: 'health',
      params: { entries: {} },
      timeoutMs: BigInt(10_000),
    });
    const latencyMs = Date.now() - start;
    if (response.error) {
      return { success: false, error: response.error, latencyMs };
    }
    return { success: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, latencyMs };
  }
}

// updatePluginAccess removed, plugin read/write access flags are now
// managed via the Tenant CRD. See `app/actions/crd/tenant.ts`.

// ============================================================================
// Team Management
//
// Team-scoped helpers (listTeamMembers / updateMemberRole / removeMember) have
// been removed. Member management now flows through the TenantMember CRD via
// `app/actions/crd/member.ts` and `useCRDWatch("TenantMember", ns)`.
// ============================================================================

// listUserSessions removed, DELETE per admin-services-completion design.md.
// GetUserSessions / RevokeUserSessions belong in the IdP's hosted UI, not the dashboard.
// The Active Sessions tab in the users/[userId] page now shows a link to the
// provider's hosted profile page (label: "Manage account at provider").
// The idp profile URL is derived from ZITADEL_ISSUER at render time.

// ============================================================================
// User Profile, daemon-RPC backed
//
// All user identity operations (profile, sessions, activity) go through
// daemon RPCs. Identities themselves are owned by Zitadel; the dashboard's
// Auth.js adapter mirrors the minimum profile data into Postgres for
// adapter-required tables.
// ============================================================================

/**
 * Fetch a user's profile via UserService.GetUserProfile and map it to the UserProfile shape.
 * Routes through the new UserService (admin-services-completion task 17).
 */
async function getUserProfile(
  tenantId: string,
  userId: string
): Promise<UserProfile> {
  const client = await getUserServiceClient();
  const resp = await client.getUserProfile({ tenantId, userId });
  const p = resp.profile;
  return {
    id: p?.id ?? userId,
    email: p?.email ?? '',
    displayName: p?.displayName ?? '',
    avatarUrl: p?.avatarUrl || null,
    tenantId,
    status: (p?.status ?? 'active') as UserProfile['status'],
    createdAt: p?.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Apply partial profile updates via UserService.UpdateUserProfile.
 * Only display_name and avatar_url are accepted; email is immutable (IdP-managed).
 * Routes through the new UserService (admin-services-completion task 17).
 */
async function updateUserProfile(
  tenantId: string,
  userId: string,
  updates: Record<string, unknown>
): Promise<UserProfile> {
  const client = await getUserServiceClient();
  const resp = await client.updateUserProfile({
    tenantId,
    userId,
    displayName: typeof updates.displayName === 'string' ? updates.displayName : '',
    // preferredLocale is the supported editable field alongside displayName.
    // avatarUrl is not accepted by UserService.UpdateUserProfile (email and
    // avatar are IdP-managed); callers passing avatarUrl have it silently ignored.
    preferredLocale: typeof updates.preferredLocale === 'string' ? updates.preferredLocale : '',
  });
  const p = resp.profile;
  return {
    id: p?.id ?? userId,
    email: p?.email ?? '',
    displayName: p?.displayName ?? '',
    avatarUrl: p?.avatarUrl || null,
    tenantId,
    status: (p?.status ?? 'active') as UserProfile['status'],
    createdAt: p?.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Retrieve user activity.
 *
 * ListAuditEvents is DEFERRED per admin-services-completion design.md.
 * This function returns an empty result set until the feature ships.
 * The /api/users/activity route handler degrades gracefully on empty.
 */
export async function getUserActivity(
  _tenantId: string,
  _userId: string,
  opts?: { page?: number; limit?: number }
): Promise<ListUserActivitiesResponse> {
  const limit = Math.min(opts?.limit ?? 20, 100);
  return { activities: [], total: 0, page: opts?.page ?? 1, limit, hasMore: false };
}

// Invitation RPCs (ListInvitations / RevokeInvitation / ResendInvitation /
// CreateInvitation) have moved to the TenantMember CRD, see
// `app/actions/crd/member.ts` (inviteMemberAction / resendInvitationAction /
// revokeMemberAction).

// ============================================================================
// Analytics, computed from daemon RPCs and Neo4j graph
// ============================================================================

import {
  GraphService,
  FindingCountGroupBy,
} from '@/src/gen/gibson/graph/v1/graph_pb';

interface KPIs {
  activeMissions: number;
  totalMissions: number;
  agentsOnline: number;
  totalAgents: number;
  totalTools: number;
  totalFindings: number;
  criticalFindings: number;
}

/**
 * Return high-level operational KPIs by combining daemon RPC data with
 * GraphService.GetFindingCounts.
 *
 * Finding count failures are handled gracefully, counts fall back to zero
 * so that the rest of the KPI data remains usable.
 */
export async function getKPIs(tenantId: string, userId?: string): Promise<KPIs> {
  const [missionsResp, agentsResp, toolsResp] = await Promise.all([
    listMissions(false, 1000, userId, tenantId),
    listAgents(undefined, userId, tenantId),
    listTools(userId, tenantId),
  ]);

  const missions = missionsResp.missions ?? [];
  const agents = agentsResp.agents ?? [];
  const tools = toolsResp.tools ?? [];

  const activeMissions = missions.filter((m) => m.status === 'running').length;
  const agentsOnline = agents.filter((a) => a.health === 'healthy').length;

  let totalFindings = 0;
  let criticalFindings = 0;

  try {
    const resp = await userClient(GraphService).getFindingCounts({
      groupBy: FindingCountGroupBy.SEVERITY,
    });
    for (const bucket of resp.buckets) {
      totalFindings += Number(bucket.count);
      if (bucket.label.toLowerCase() === 'critical') {
        criticalFindings = Number(bucket.count);
      }
    }
  } catch (err) {
    console.warn('getKPIs: GetFindingCounts failed, finding counts will be 0', err);
  }

  return {
    activeMissions,
    totalMissions: missions.length,
    agentsOnline,
    totalAgents: agents.length,
    totalTools: tools.length,
    totalFindings,
    criticalFindings,
  };
}

/**
 * Return finding counts grouped by severity via GraphService.GetFindingCounts.
 *
 * Returns an empty object on failure so the caller can degrade gracefully.
 */
export async function getFindingsBySeverity(tenantId: string, _userId?: string): Promise<Record<string, number>> {
  try {
    const resp = await userClient(GraphService).getFindingCounts({
      groupBy: FindingCountGroupBy.SEVERITY,
    });
    const counts: Record<string, number> = {};
    for (const bucket of resp.buckets) {
      counts[bucket.label] = Number(bucket.count);
    }
    return counts;
  } catch (err) {
    console.warn('getFindingsBySeverity: GetFindingCounts failed', err);
    return {};
  }
}

/**
 * Return finding counts grouped by category via GraphService.GetFindingCounts.
 *
 * Returns an empty object on failure.
 */
export async function getFindingsByCategory(tenantId: string, _userId?: string): Promise<Record<string, number>> {
  try {
    const resp = await userClient(GraphService).getFindingCounts({
      groupBy: FindingCountGroupBy.CATEGORY,
    });
    const counts: Record<string, number> = {};
    for (const bucket of resp.buckets) {
      counts[bucket.label] = Number(bucket.count);
    }
    return counts;
  } catch (err) {
    console.warn('getFindingsByCategory: GetFindingCounts failed', err);
    return {};
  }
}

interface FindingsTimeSeriesPoint {
  date: string;
  count: number;
}

/**
 * Return a daily time series of finding counts over the past `days` days
 * via GraphService.GetFindingTimeSeries.
 *
 * Returns an empty array on failure.
 */
export async function getFindingsTimeSeries(
  tenantId: string,
  days = 30,
  _userId?: string
): Promise<FindingsTimeSeriesPoint[]> {
  try {
    const resp = await userClient(GraphService).getFindingTimeSeries({ days });
    return resp.points.map((pt) => {
      // pt.date is a google.protobuf.Timestamp; convert to YYYY-MM-DD ISO date string.
      const dateStr = pt.date
        ? new Date(Number(pt.date.seconds) * 1000).toISOString().slice(0, 10)
        : '';
      return { date: dateStr, count: Number(pt.count) };
    });
  } catch (err) {
    console.warn('getFindingsTimeSeries: GetFindingTimeSeries failed', err);
    return [];
  }
}

interface MissionHeatmapCell {
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  /** 0-23 */
  hour: number;
  count: number;
}

/**
 * Aggregate mission start times into a day-of-week x hour heatmap.
 *
 * Derived entirely from `listMissions` - no Neo4j access is required.
 * Missions whose start_time is zero (not yet started) are skipped.
 */
export async function getMissionHeatmap(tenantId: string, userId?: string): Promise<MissionHeatmapCell[]> {
  const missionsResp = await listMissions(false, 1000, userId, tenantId);
  const missions = missionsResp.missions ?? [];

  // key: "dayOfWeek:hour"
  const buckets = new Map<string, number>();

  for (const m of missions) {
    const startMs = Number(m.startTime) * 1000;
    if (!startMs) continue;
    const d = new Date(startMs);
    const key = `${d.getDay()}:${d.getHours()}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const cells: MissionHeatmapCell[] = [];
  for (const [key, count] of buckets) {
    const [dow, hour] = key.split(':').map(Number);
    cells.push({ dayOfWeek: dow, hour, count });
  }

  // Sort for deterministic output: by day then hour
  cells.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);
  return cells;
}

interface AgentPerformanceRecord {
  name: string;
  healthy: boolean;
  kind: string;
  /**
   * Number of missions whose name contains the agent's name.
   * This is a best-effort proxy; the daemon list APIs do not expose a direct
   * agent-to-mission assignment relationship.
   */
  taskCount: number;
}

/**
 * Build a per-agent performance summary from the registered agent list and
 * completed mission history.
 */
export async function getAgentPerformance(tenantId: string, userId?: string): Promise<AgentPerformanceRecord[]> {
  const [agentsResp, missionsResp] = await Promise.all([
    listAgents(undefined, userId, tenantId),
    listMissions(false, 1000, userId, tenantId),
  ]);

  const agents = agentsResp.agents ?? [];
  const missions = missionsResp.missions ?? [];

  return agents.map((a) => {
    const taskCount = missions.filter((m) =>
      m.name.toLowerCase().includes(a.name.toLowerCase())
    ).length;

    return {
      name: a.name,
      healthy: a.health === 'healthy',
      kind: a.kind,
      taskCount,
    };
  });
}

// initiateSignup / getProvisioningStatusByUser removed, signup and
// provisioning lifecycle moved to the Tenant CRD operator. See
// `app/actions/crd/tenant.ts` for the equivalent CRD-backed flow.

// Member invitation and removal now flow through `app/actions/crd/member.ts`
// against the TenantMember CRD.

// Capability Grant RPCs (RegisterCapabilityGrant / ExecuteAgentCapability / ListAgentCapabilities
// / GetCapabilityGrantStatus / RevokeCapabilityGrant / ListCapabilityGrantAgents /
// CreateHostRegistrationToken) have moved to the AgentEnrollment CRD, see
// `app/actions/crd/enrollment.ts`.

// ---------------------------------------------------------------------------
// Supported LLM providers (introspection for dashboard form rendering)
// ---------------------------------------------------------------------------

// CredentialFieldDescriptor / ModelDescriptor / SupportedProviderDescriptor
// moved to ./gibson-client-types so client components can type-import them
// without pulling grpc-js into the browser bundle. Re-exported at the top of
// this file for back-compat with server-side callers.

// getSupportedProviders removed, DELETE per admin-services-completion design.md.
// GetSupportedProviders was a Bucket C RPC with no active caller path and is
// deleted from the proto entirely. The /api/settings/providers/supported route
// and useSupportedProviders hook are removed.

// ============================================================================
// Daemon-backed Provider Config (TenantAdminService, migrated from
// DaemonAdminService per admin-services-completion spec task 16)
//
// These functions call the TenantAdminService provider-config RPCs via
// getAdminClient(userId, tenantId) → RPC → friendly camelCased shape.
// ============================================================================

// ---------------------------------------------------------------------------
// Daemon provider record types
// ---------------------------------------------------------------------------

/**
 * Read-side representation of a daemon-managed LLM provider config.
 * Credentials are always masked: {"api_key": "****xyz"}.
 *
 * Prefixed `Daemon` to avoid collision with the legacy K8s-backed ProviderRecord
 * until task 15 removes the old function set.
 */
export interface DaemonProviderRecord {
  /** Server-generated UUID. */
  id: string;
  /** Tenant-scoped human name. */
  name: string;
  /** Provider type identifier, e.g. "anthropic", "openai", "bedrock". */
  type: string;
  /** Model used when the caller does not specify one. */
  defaultModel: string;
  /** True when this is the tenant's designated default provider. */
  isDefault: boolean;
  /** True when the provider is active. */
  enabled: boolean;
  /** Masked credential values for display only. {"api_key": "****xyz"} */
  credentialsMasked: Record<string, string>;
  /** RFC 3339 creation timestamp. */
  createdAt: string;
  /** RFC 3339 last-update timestamp. */
  updatedAt: string;
  /**
   * Capabilities this provider fulfils ("chat" and/or "embedding"). Empty proto
   * is normalised to chat-only here. (E11 BYO-embedder, gibson#810.)
   */
  capabilities: ProviderCapability[];
  /**
   * Default embedding model, independent of {@link defaultModel} (the chat
   * model). Empty when the provider does not serve embeddings.
   */
  defaultEmbeddingModel: string;
}

/**
 * Write-side shape for creating or updating a daemon-managed LLM provider.
 * Credentials are plaintext on the wire; the daemon encrypts them immediately
 * via AES-256-GCM + KeyProvider and never persists the plaintext.
 *
 * Prefixed `Daemon` to avoid collision with the legacy ProviderConfigInput
 * from src/types/provider.ts.
 */
// DaemonProviderConfigInput moved to ./gibson-client-types, see top-of-file note.

/**
 * Structured result of a daemon-side provider connectivity test.
 * Note: latencyMs is returned as number here (converted from proto int64 bigint).
 */
interface DaemonProviderTestResult {
  /** True when the upstream returned a successful response. */
  ok: boolean;
  /** Round-trip time in milliseconds (always reported, even on failure). */
  latencyMs: number;
  /** Model used for the test completion (when ok is true). */
  model: string;
  /** Cleaned upstream error message (when ok is false). */
  error?: string;
  /**
   * Live model catalogue returned by the provider's API for these credentials.
   * Empty for providers that don't expose a list endpoint, OR when ok is false.
   * Spec: providers-wizard.
   */
  models: Array<{ name: string; family: string; contextWindow: number }>;
}

/**
 * Health status for a daemon-managed provider.
 */
interface DaemonProviderHealthStatus {
  status: 'healthy' | 'unhealthy' | 'unknown';
  /** RFC 3339 timestamp of the last health check. */
  lastCheckAt?: string;
  /** Error message when status is unhealthy. */
  lastError?: string;
}

// ---------------------------------------------------------------------------
// LLM execution types (spec 25 §5, GibsonLLMAdapter inputs/outputs)
// ---------------------------------------------------------------------------

/**
 * A single message in a conversation sent to executeLLM / streamLLM.
 * Maps to the proto gibson.tenant.v1.LLMMessageContent.
 */
export interface LLMMessage {
  /** "system" | "user" | "assistant" | "tool" */
  role: string;
  /** Text content of the message. */
  content?: string;
  /** Tool calls requested by the LLM (assistant role). */
  toolCalls?: DaemonLLMToolCall[];
  /** Tool results included in this message (tool role). */
  toolResults?: DaemonLLMToolResult[];
  /** Tool name, for tool-role messages. */
  name?: string;
}

/**
 * Tool definition exposed to the LLM.
 * Maps to the proto gibson.tenant.v1.LLMToolDef.
 */
export interface DaemonLLMToolDef {
  name: string;
  description: string;
  /** JSON-encoded JSON Schema for the tool arguments. */
  parametersJson: string;
}

/**
 * A tool invocation requested by the LLM.
 * Maps to the proto gibson.tenant.v1.LLMToolCall.
 */
export interface DaemonLLMToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments string. */
  arguments: string;
}

/**
 * The output of a tool call.
 * Maps to the proto gibson.tenant.v1.LLMToolResult.
 */
export interface DaemonLLMToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

/**
 * Token usage reported for an LLM completion.
 * Maps to the proto gibson.tenant.v1.LLMTokenUsage.
 */
export interface DaemonLLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Controls the structure of the LLM's output.
 * Maps to the proto gibson.tenant.v1.ResponseFormat.
 */
export interface DaemonResponseFormat {
  /** "text" | "json_object" | "json_schema" */
  type: string;
  /** Schema name (json_schema mode only). */
  name?: string;
  /** JSON-encoded schema (json_schema mode only). */
  schemaJson?: string;
  /** Enables strict schema adherence when supported by the provider. */
  strict?: boolean;
}

/**
 * Parameters for executeLLM.
 */
export interface ExecuteLLMParams {
  providerName: string;
  /** Overrides the provider's default_model when set. */
  model?: string;
  messages: LLMMessage[];
  tools?: DaemonLLMToolDef[];
  responseFormat?: DaemonResponseFormat;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

/**
 * Response from executeLLM (non-streaming completion).
 */
export interface DaemonExecuteLLMResponse {
  /** Text response from the LLM. */
  content: string;
  /** Tool calls the LLM requested. */
  toolCalls: DaemonLLMToolCall[];
  /** "stop" | "length" | "tool_calls" | "content_filter" */
  finishReason: string;
  usage: DaemonLLMUsage;
}

// ---------------------------------------------------------------------------
// Proto → friendly type helpers
// ---------------------------------------------------------------------------

function fromProtoProviderRecord(
  p: import('@/src/gen/gibson/tenant/v1/provider_pb').ProviderRecord,
): DaemonProviderRecord {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    defaultModel: p.defaultModel,
    isDefault: p.isDefault,
    enabled: p.enabled,
    credentialsMasked: { ...p.credentialsMasked },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    capabilities: fromProtoCapabilities(p.capabilities ?? []),
    defaultEmbeddingModel: p.defaultEmbeddingModel,
  };
}

function toProtoDaemonConfigInput(
  input: DaemonProviderConfigInput,
): import('@/src/gen/gibson/tenant/v1/provider_pb').ProviderConfigInput {
  return {
    name: input.name,
    type: input.type,
    defaultModel: input.defaultModel,
    credentials: { ...input.credentials },
    setAsDefault: input.setAsDefault ?? false,
    capabilities: toProtoCapabilities(input.capabilities ?? []),
    defaultEmbeddingModel: input.defaultEmbeddingModel ?? '',
  } as import('@/src/gen/gibson/tenant/v1/provider_pb').ProviderConfigInput;
}

function fromProtoLLMUsage(
  u: import('@/src/gen/gibson/tenant/v1/provider_pb').LLMTokenUsage | undefined,
): DaemonLLMUsage {
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    totalTokens: u?.totalTokens ?? 0,
  };
}

function fromProtoLLMToolCall(
  tc: import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolCall,
): DaemonLLMToolCall {
  return { id: tc.id, name: tc.name, arguments: tc.arguments };
}

function toLLMMessageContent(
  msg: LLMMessage,
): import('@/src/gen/gibson/tenant/v1/provider_pb').LLMMessageContent {
  return {
    role: msg.role,
    content: msg.content ?? '',
    toolCalls: (msg.toolCalls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    })) as import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolCall[],
    toolResults: (msg.toolResults ?? []).map((tr) => ({
      toolCallId: tr.toolCallId,
      content: tr.content,
      isError: tr.isError,
    })) as import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolResult[],
    name: msg.name ?? '',
  } as import('@/src/gen/gibson/tenant/v1/provider_pb').LLMMessageContent;
}

function toLLMToolDef(
  def: DaemonLLMToolDef,
): import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolDef {
  return {
    name: def.name,
    description: def.description,
    parametersJson: def.parametersJson,
  } as import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolDef;
}

function toProtoResponseFormat(
  fmt: DaemonResponseFormat,
): import('@/src/gen/gibson/tenant/v1/provider_pb').ResponseFormat {
  return {
    type: fmt.type,
    name: fmt.name ?? '',
    schemaJson: fmt.schemaJson ?? '',
    strict: fmt.strict ?? false,
  } as import('@/src/gen/gibson/tenant/v1/provider_pb').ResponseFormat;
}

function buildExecRequest(
  params: ExecuteLLMParams,
): {
  providerName: string;
  model: string;
  messages: import('@/src/gen/gibson/tenant/v1/provider_pb').LLMMessageContent[];
  tools: import('@/src/gen/gibson/tenant/v1/provider_pb').LLMToolDef[];
  responseFormat?: import('@/src/gen/gibson/tenant/v1/provider_pb').ResponseFormat;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop: string[];
} {
  return {
    providerName: params.providerName,
    model: params.model ?? '',
    messages: params.messages.map(toLLMMessageContent),
    tools: (params.tools ?? []).map(toLLMToolDef),
    responseFormat: params.responseFormat ? toProtoResponseFormat(params.responseFormat) : undefined,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    topP: params.topP,
    stop: params.stop ?? [],
  };
}

// ---------------------------------------------------------------------------
// Daemon-backed provider CRUD functions
// ---------------------------------------------------------------------------

/**
 * List all LLM provider configs for the calling tenant via the daemon
 * ListProviders RPC. Returns masked credential values only.
 *
 * Named `daemonListProviders` to avoid collision with the legacy K8s-backed
 * `listProviders` function above. Task 15 will remove the K8s version and
 * rename this to `listProviders`.
 */
export async function daemonListProviders(
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderRecord[]> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.listProviders({});
  return (resp.providers ?? []).map(fromProtoProviderRecord);
}

/**
 * Retrieve a single provider config by name via the daemon GetProvider RPC.
 * Throws a ConnectError (Code.NotFound) when no provider with the given name
 * exists for the tenant.
 */
export async function daemonGetProvider(
  name: string,
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderRecord> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.getProvider({ name });
  if (!resp.provider) {
    throw new ConnectError(`Provider '${name}' not found`, Code.NotFound);
  }
  return fromProtoProviderRecord(resp.provider);
}

/**
 * Create a new provider config via the daemon CreateProvider RPC.
 * Credentials are transmitted as plaintext and encrypted immediately by
 * the daemon, the dashboard process never persists them.
 * Throws a ConnectError (Code.AlreadyExists) when the name is already in use.
 */
export async function daemonCreateProvider(
  input: DaemonProviderConfigInput,
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderRecord> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.createProvider({ input: toProtoDaemonConfigInput(input) });
  if (!resp.provider) {
    throw new ConnectError('CreateProvider returned no provider record', Code.Internal);
  }
  return fromProtoProviderRecord(resp.provider);
}

/**
 * Update an existing provider config via the daemon UpdateProvider RPC.
 * Empty credential values in `input` mean "retain the stored value".
 * Throws a ConnectError (Code.NotFound) when the named provider does not exist.
 */
export async function daemonUpdateProvider(
  name: string,
  input: DaemonProviderConfigInput,
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderRecord> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.updateProvider({ name, input: toProtoDaemonConfigInput(input) });
  if (!resp.provider) {
    throw new ConnectError('UpdateProvider returned no provider record', Code.Internal);
  }
  return fromProtoProviderRecord(resp.provider);
}

/**
 * Permanently delete a provider config via the daemon DeleteProvider RPC.
 * Throws a ConnectError (Code.NotFound) when the named provider does not exist.
 */
export async function daemonDeleteProvider(
  name: string,
  userId?: string,
  tenantId?: string,
): Promise<void> {
  const client = await getAdminClient(userId, tenantId);
  await client.deleteProvider({ name });
}

/**
 * Test connectivity to a provider via the daemon TestProvider RPC.
 * The config is NOT persisted, the daemon validates and probes the upstream
 * in process memory only.
 *
 * Note: the proto latencyMs field is int64 (bigint in TS); this function
 * converts it to a plain number for caller convenience.
 */
export async function daemonTestProvider(
  input: DaemonProviderConfigInput,
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderTestResult> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.testProvider({ input: toProtoDaemonConfigInput(input) });
  return {
    ok: resp.ok,
    latencyMs: Number(resp.latencyMs),
    model: resp.model,
    error: resp.error || undefined,
    models: (resp.models ?? []).map((m) => ({
      name: m.name,
      family: m.family ?? '',
      contextWindow: m.contextWindow,
    })),
  };
}

/**
 * Get the health status of a named provider via the daemon GetProviderHealth RPC.
 */
export async function daemonGetProviderHealth(
  name: string,
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderHealthStatus> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.getProviderHealth({ name });
  return {
    status: resp.healthy ? 'healthy' : resp.lastCheckedAt ? 'unhealthy' : 'unknown',
    lastCheckAt: resp.lastCheckedAt || undefined,
    lastError: resp.error || undefined,
  };
}

/**
 * Get the tenant's current default provider via the daemon GetDefaultProvider RPC.
 * Returns null when no default has been set.
 */
export async function daemonGetDefaultProvider(
  userId?: string,
  tenantId?: string,
): Promise<DaemonProviderRecord | null> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.getDefaultProvider({});
  return resp.provider ? fromProtoProviderRecord(resp.provider) : null;
}

/**
 * Designate a provider as the tenant's default via the daemon SetDefaultProvider RPC.
 * All other providers are demoted atomically on the daemon side.
 * Throws a ConnectError (Code.NotFound) when the named provider does not exist.
 */
export async function daemonSetDefaultProvider(
  name: string,
  userId?: string,
  tenantId?: string,
): Promise<void> {
  const client = await getAdminClient(userId, tenantId);
  await client.setDefaultProvider({ name });
}

// ---------------------------------------------------------------------------
// Daemon-backed LLM execution functions
// ---------------------------------------------------------------------------

/**
 * Issue a non-streaming LLM completion request via the daemon ExecuteLLM RPC.
 *
 * The daemon resolves the provider name to an encrypted credential record,
 * decrypts it in process memory, and dispatches to the appropriate
 * Eino-backed provider. Plaintext credentials never leave daemon memory.
 *
 * Throws a ConnectError on any gRPC-level failure (NotFound when the provider
 * name is unknown, ResourceExhausted on rate-limit, Internal on upstream
 * failure). The routes layer (task 11) maps these to HTTP status codes.
 */
export async function executeLLM(
  params: ExecuteLLMParams,
  userId?: string,
  tenantId?: string,
): Promise<DaemonExecuteLLMResponse> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.executeLLM(buildExecRequest(params));
  return {
    content: resp.content,
    toolCalls: (resp.toolCalls ?? []).map(fromProtoLLMToolCall),
    finishReason: resp.finishReason,
    usage: fromProtoLLMUsage(resp.usage),
  };
}

// ---------------------------------------------------------------------------
// Admin v1 sub-module re-exports
// spec: secrets-tenant-lifecycle Task 6
//
// These named sub-modules mirror one proto service each and are the canonical
// import path for new server-only code. They compose with the existing
// userClient / serviceClient factories defined above.
// ---------------------------------------------------------------------------

export * as secretsAdmin from './gibson-client/secrets';
export * as pluginsAdmin from './gibson-client/plugins-admin';
export * as grantsAdmin from './gibson-client/grants';
export * as tenantBrokerAdmin from './gibson-client/tenant-broker-config';
