import { createClient, ConnectError, Code } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { getSVID } from './spiffe';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { DaemonAdminService } from '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb';
import type {
  MissionInfo,
  AgentInfo,
  ToolInfo,
  PluginInfo,
  StatusResponse,
  Capabilities,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';
import type {
  MembershipInfo,
} from '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb';
import type {
  UserSession,
  ListUserSessionsResponse,
  UserProfile,
  UserActivity,
  ListUserActivitiesResponse,
} from '@/src/types/user';
import { serverConfig } from './config';

// Tenant CRUD/lookup has moved to the Tenant CRD operator. Use
// `@/src/lib/k8s/tenants` for tenant access. Tenant proto types are no
// longer exported by this module.

const GIBSON_ADDR = serverConfig.gibsonDaemonUrl;

// ---------------------------------------------------------------------------
// SPIFFE mTLS Transport
// ---------------------------------------------------------------------------
// The dashboard authenticates to the daemon via SPIFFE mTLS using the X.509-SVID
// issued by the SPIRE Agent. User identity is forwarded as gRPC metadata headers:
//   x-gibson-user-id  — the authenticated user's Better Auth user ID
//   x-gibson-tenant   — the user's active tenant ID
//
// No Authorization header is set. The mTLS handshake proves the dashboard's
// identity (spiffe://gibson.io/platform/dashboard); the metadata carries the
// acting user's context for data-scoped operations.

/**
 * Create a Connect-ES gRPC transport using SPIFFE mTLS credentials.
 *
 * @param userId  - Optional Better Auth user ID forwarded as x-gibson-user-id.
 * @param tenantId - Optional tenant ID forwarded as x-gibson-tenant.
 */
function getTransport(userId?: string, tenantId?: string) {
  const svid = getSVID();

  const interceptors: Parameters<typeof createGrpcTransport>[0]['interceptors'] = [
    (next) => (req) => {
      if (userId) req.header.set('x-gibson-user-id', userId);
      if (tenantId) req.header.set('x-gibson-tenant', tenantId);
      return next(req);
    },
  ];

  return createGrpcTransport({
    baseUrl: GIBSON_ADDR,
    nodeOptions: svid
      ? {
          cert: svid.certificate,
          key: svid.privateKey,
          ca: svid.trustBundle,
        }
      : undefined,
    interceptors,
  });
}

function getClient(userId?: string, tenantId?: string) {
  return createClient(DaemonService, getTransport(userId, tenantId));
}

function getAdminClient(userId?: string, tenantId?: string) {
  return createClient(DaemonAdminService, getTransport(userId, tenantId));
}

export async function getStatus(userId?: string, tenantId?: string): Promise<StatusResponse> {
  const client = getClient(userId, tenantId);
  const response = await client.status({});
  return response;
}

export async function ping(userId?: string, tenantId?: string): Promise<{ timestamp: bigint }> {
  const client = getClient(userId, tenantId);
  const response = await client.ping({});
  return response;
}

export async function listMissions(activeOnly = false, limit = 100, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.listMissions({
    activeOnly,
    limit,
  });
  return response;
}

export async function listAgents(kind?: string, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.listAgents({
    kind: kind || '',
  });
  return response;
}

export async function listTools(userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.listTools({});
  return response;
}

export async function listPlugins(userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.listPlugins({});
  return response;
}

export async function stopMission(missionId: string, force = false, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.stopMission({
    missionId,
    force,
  });
  return response;
}

export async function pauseMission(missionId: string, force = false, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.pauseMission({
    missionId,
    force,
  });
  return response;
}

export async function resumeMission(missionId: string, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
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

export async function getMissionHistory(name: string, limit = 100, offset = 0, userId?: string, tenantId?: string) {
  const client = getClient(userId, tenantId);
  const response = await client.getMissionHistory({
    name,
    limit,
    offset,
  });
  return response;
}

export interface TenantLangfuseCredentials {
  publicKey: string;
  secretKey: string;
  host: string;
  projectId: string;
}

/**
 * Retrieve per-tenant Langfuse credentials from the Gibson daemon.
 *
 * Throws a {@link ConnectError} with code {@link Code.NotFound} when the
 * tenant has not yet been provisioned. Callers should catch that case and
 * fall back to platform-level credentials as appropriate.
 */
export async function getTenantLangfuseCredentials(tenantId: string, userId?: string, _tenantCtx?: string): Promise<TenantLangfuseCredentials> {
  const client = getAdminClient(userId, tenantId);
  const response = await client.getTenantLangfuseCredentials({ tenantId });
  return {
    publicKey: response.publicKey,
    secretKey: response.secretKey,
    host: response.host,
    projectId: response.projectId,
  };
}

/**
 * Store per-tenant Langfuse credentials in the Gibson daemon.
 * Called after provisioning a new Langfuse project for a tenant.
 */
export async function setTenantLangfuseCredentials(
  tenantId: string,
  credentials: TenantLangfuseCredentials,
  userId?: string
): Promise<void> {
  const client = getAdminClient(userId, tenantId);
  await client.setTenantLangfuseCredentials({
    tenantId,
    publicKey: credentials.publicKey,
    secretKey: credentials.secretKey,
    host: credentials.host,
    projectId: credentials.projectId,
  });
}

/**
 * Delete per-tenant Langfuse credentials from the Gibson daemon.
 * Called when deprovisioning a tenant's Langfuse project.
 */
export async function deleteTenantLangfuseCredentials(tenantId: string, userId?: string): Promise<void> {
  const client = getAdminClient(userId, tenantId);
  await client.deleteTenantLangfuseCredentials({ tenantId });
}

export { ConnectError, Code };

// ============================================================================
// Tenant Management API
// ============================================================================

// TenantUpdates removed — tenant mutation moved to the Tenant CRD operator.

export interface CreateAPIKeyResult {
  keyId: string;
  /** Raw key value including the "gsk_" prefix — shown once only. */
  rawKey: string;
  tenantId: string;
}

export interface AuditLogQueryOptions {
  startTime?: Date;
  endTime?: Date;
  action?: string;
  limit?: number;
}

export interface AuditLogEntry {
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

export interface TenantQuota {
  tenantId: string;
  maxMissions: number;
  maxAgents: number;
  maxAPIKeys: number;
  maxMembers: number;
  rateLimitRpm: number;
}

export interface ProvisioningStep {
  name: string;
  status: string;
  message: string;
}

// listTenants / getTenant / updateTenant removed — tenant CRUD and lookup
// have moved to the Tenant CRD operator. Use `@/src/lib/k8s/tenants` for
// reads and `app/actions/crd/tenant.ts` for mutations.

/**
 * Issue a new API key for a tenant.
 *
 * `allowedKinds` and `allowedNames` restrict which component kinds/names the
 * key may access; pass empty arrays for unrestricted access.  The returned
 * `rawKey` is shown once and never stored in plaintext — callers must
 * surface it to the user immediately.
 */
export async function createAPIKey(
  tenantId: string,
  allowedKinds: string[],
  allowedNames: string[],
  userId?: string
): Promise<CreateAPIKeyResult> {
  const client = getAdminClient(userId, tenantId);
  const response = await client.createAPIKey({ tenantId, allowedKinds, allowedNames });
  return {
    keyId: response.keyId,
    rawKey: response.rawKey,
    tenantId: response.tenantId,
  };
}

/**
 * List all API key metadata records for a tenant.  Raw key values are never
 * returned by this RPC.
 */
export async function listAPIKeys(tenantId: string, userId?: string) {
  const client = getAdminClient(userId, tenantId);
  const response = await client.listAPIKeys({ tenantId });
  return response.keys ?? [];
}

/**
 * Permanently revoke an API key.  The key cannot be recovered after revocation.
 */
export async function revokeAPIKey(tenantId: string, keyId: string, userId?: string): Promise<void> {
  const client = getAdminClient(userId, tenantId);
  await client.revokeAPIKey({ keyId });
}

/**
 * List all tenants a user belongs to with their role in each.
 */
export async function listUserTenants(userId: string, callerUserId?: string): Promise<MembershipInfo[]> {
  const client = getAdminClient(callerUserId);
  const response = await client.listUserTenants({ userId });
  return response.memberships ?? [];
}


// getAuthSchema / getProvisioningStatus / deprovisionTenant removed —
// auth schema is now served by the FGA-backed GetMyPermissions RPC, and
// provisioning lifecycle moved to the Tenant CRD operator.

// ============================================================================
// Audit Log — ListAuditEvents RPC (DaemonAdminService)
// ============================================================================

/**
 * Query the audit log for a tenant via the ListAuditEvents RPC.
 *
 * Maps the SDK AuditEvent proto fields to the local AuditLogEntry interface.
 */
async function queryAuditLog(
  tenantId: string,
  opts: AuditLogQueryOptions,
  userId?: string
): Promise<AuditLogEntry[]> {
  const client = getAdminClient(userId, tenantId);
  const response = await client.listAuditEvents({
    tenantId,
    fromTime: opts.startTime?.toISOString() ?? '',
    toTime: opts.endTime?.toISOString() ?? '',
    eventTypes: opts.action ? [opts.action] : [],
    actorUserId: '',
    limit: opts.limit ?? 50,
  });
  return (response.events ?? []).map((e) => ({
    id: e.traceId,
    tenantId: e.tenantId,
    action: e.eventType,
    actorSubject: e.actorUserId,
    actorEmail: e.actorEmail,
    resourceKind: '',
    resourceId: e.targetResource,
    timestamp: e.timestamp,
    metadata: e.details ?? {},
  }));
}

// ============================================================================
// Quota Management — GetTenantQuota / SetTenantQuota RPCs (DaemonAdminService)
// ============================================================================

/**
 * Retrieve the resource quota for a tenant via GetTenantQuota RPC.
 */
async function getTenantQuota(
  tenantId: string,
  targetTenantId: string,
  userId?: string
): Promise<TenantQuota> {
  const client = getAdminClient(userId, tenantId);
  const response = await client.getTenantQuota({ tenantId: targetTenantId });
  const q = response.quota;
  return {
    tenantId: targetTenantId,
    maxMissions: q?.maxMissions ?? 0,
    maxAgents: q?.maxAgents ?? 0,
    maxAPIKeys: 0,
    maxMembers: 0,
    rateLimitRpm: 0,
  };
}

/**
 * Set the resource quota for a tenant via SetTenantQuota RPC.
 */
async function setTenantQuota(
  tenantId: string,
  targetTenantId: string,
  quota: Partial<TenantQuota>,
  userId?: string
): Promise<TenantQuota> {
  const client = getAdminClient(userId, tenantId);
  const response = await client.setTenantQuota({
    tenantId: targetTenantId,
    quota: {
      maxMissions: quota.maxMissions ?? 0,
      maxAgents: quota.maxAgents ?? 0,
      maxFindings: BigInt(0),
      planTier: '',
    },
  });
  const q = response.quota;
  return {
    tenantId: targetTenantId,
    maxMissions: q?.maxMissions ?? 0,
    maxAgents: q?.maxAgents ?? 0,
    maxAPIKeys: 0,
    maxMembers: 0,
    rateLimitRpm: 0,
  };
}

// ============================================================================
// Alert Management — ListAlerts / MarkAlertRead / MarkAllAlertsRead RPCs
// ============================================================================

export interface AlertRecord {
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

/**
 * List alerts for a user via the daemon ListAlerts RPC.
 */
export async function listAlerts(
  tenantId: string,
  userId: string,
  opts?: { unreadOnly?: boolean; limit?: number },
  callerUserId?: string
): Promise<AlertRecord[]> {
  const client = getAdminClient(callerUserId, tenantId);
  const resp = await client.listAlerts({
    tenantId,
    userId,
    unreadOnly: opts?.unreadOnly ?? false,
    limit: opts?.limit ?? 50,
  });
  return (resp.alerts ?? []).map((a) => ({
    id: a.id,
    tenantId: a.tenantId,
    userId: a.userId,
    title: a.title,
    body: a.body,
    severity: a.severity,
    read: a.read,
    createdAt: new Date(Number(a.createdAtUnix) * 1000).toISOString(),
    source: a.source,
    sourceId: a.sourceId,
  }));
}

/**
 * Mark a single alert as read via the daemon MarkAlertRead RPC.
 */
export async function markAlertRead(
  tenantId: string,
  alertId: string,
  userId?: string
): Promise<void> {
  const client = getAdminClient(userId, tenantId);
  await client.markAlertRead({ tenantId, alertId });
}

/**
 * Mark all alerts for a user as read via the daemon MarkAllAlertsRead RPC.
 * Returns the count of alerts marked as read.
 */
export async function markAllAlertsRead(
  tenantId: string,
  userId: string,
  callerUserId?: string
): Promise<number> {
  const client = getAdminClient(callerUserId, tenantId);
  const resp = await client.markAllAlertsRead({ tenantId, userId });
  return resp.count;
}

// ============================================================================
// Conversation History — ListConversations / GetConversation RPCs
// ============================================================================

export interface ConversationRecord {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessageRecord {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * List conversations for a user via the daemon ListConversations RPC.
 */
export async function listConversations(
  tenantId: string,
  userId: string,
  limit = 20,
  callerUserId?: string
): Promise<ConversationRecord[]> {
  const client = getAdminClient(callerUserId, tenantId);
  const resp = await client.listConversations({ tenantId, userId, limit });
  return (resp.conversations ?? []).map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    userId: c.userId,
    title: c.title,
    createdAt: new Date(Number(c.createdAtUnix) * 1000).toISOString(),
    updatedAt: new Date(Number(c.updatedAtUnix) * 1000).toISOString(),
    messageCount: c.messageCount,
  }));
}

/**
 * Get a conversation with its full message history via the daemon GetConversation RPC.
 */
export async function getConversation(
  tenantId: string,
  conversationId: string,
  userId?: string
): Promise<{ conversation: ConversationRecord | null; messages: ConversationMessageRecord[] }> {
  const client = getAdminClient(userId, tenantId);
  const resp = await client.getConversation({ tenantId, conversationId });
  const conv = resp.conversation;
  return {
    conversation: conv
      ? {
          id: conv.id,
          tenantId: conv.tenantId,
          userId: conv.userId,
          title: conv.title,
          createdAt: new Date(Number(conv.createdAtUnix) * 1000).toISOString(),
          updatedAt: new Date(Number(conv.updatedAtUnix) * 1000).toISOString(),
          messageCount: conv.messageCount,
        }
      : null,
    messages: (resp.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(Number(m.createdAtUnix) * 1000).toISOString(),
    })),
  };
}

// ============================================================================
// Serialization Helpers
// Convert proto message objects (with BigInt timestamps) to plain JS objects
// ============================================================================

/** Serialized form of a MissionInfo proto message. */
export interface SerializedMission {
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
  /** Path to the workflow YAML file (may be `"<inline>"` for inline missions). */
  workflowPath: string;
  /** Original mission YAML content (populated for inline missions). */
  workflowYaml: string;
  /** Human-readable mission description. */
  description: string;
}

/** Serialized form of an AgentInfo proto message. */
export interface SerializedAgent {
  id: string;
  name: string;
  /** Component kind — always `"agent"` for agents. */
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
export interface SerializedCapabilities {
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
export interface SerializedTool {
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
export interface SerializedPlugin {
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
export interface SerializedStatus {
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
 * Convert a proto `google.protobuf.Timestamp`-shaped object — one that has a
 * `seconds` BigInt field and a `nanos` number field — to an ISO 8601 string.
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
  // seconds is BigInt — convert to ms and fold in the sub-second nanos portion.
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms).toISOString();
}

/**
 * Convert a raw `int64` Unix epoch seconds BigInt field from the daemon proto
 * to a plain JS `number`.
 *
 * Returns `null` when the value is `0n` — the proto default, which signals
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
 * - `progress`: `double` in [0.0, 1.0] — multiply by 100 for a percentage.
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
    workflowPath: m.workflowPath,
    workflowYaml: m.workflowYaml,
    description: m.description,
  };
}

/**
 * Serialize an `AgentInfo` proto message to a plain JSON-safe object.
 *
 * All proto fields are mapped:
 * - `capabilities`: repeated string field — copied into a fresh array so the
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
 *   as JS numbers — they are always within `Number.MAX_SAFE_INTEGER`.
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
// Provider Management — stored as JSON array in tenant config under 'providers'
// ============================================================================

export interface ProviderRecord {
  name: string;
  displayName: string;
  type: string;
  apiKey?: string;
  apiKeyMasked?: string;
  baseUrl?: string;
  defaultModel?: string;
  isDefault: boolean;
  isEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  health?: { status: string; latencyMs?: number; lastCheckAt?: string; lastSuccessAt?: string };
  timeoutSeconds?: number;
  maxRetries?: number;
  fallbackPosition?: number;
  metadata?: Record<string, string>;
}

export interface ListProvidersResult {
  providers: ProviderRecord[];
  defaultProvider: string | null;
  fallbackChain: string[];
}

/** Result shape returned by {@link testProvider} and embedded in {@link getProviderHealth}. */
export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  testedAt: string;
}

/**
 * Internal shape of a provider entry as serialised into the tenant config map.
 * The `apiKey` is stored server-side only and is never sent to the browser —
 * only a masked representation appears in {@link ProviderRecord}.
 */
interface ProviderConfig {
  name: string;
  type: 'anthropic' | 'openai' | 'google' | 'ollama';
  apiKey: string;
  model: string;
  baseUrl?: string;
  isDefault?: boolean;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Read the provider list from the tenant's Kubernetes Secret.
 *
 * Storage moved from the (now deleted) Tenant RPC config field to a
 * per-tenant Secret `llm-providers` in namespace `tenant-{id}`. The
 * `userId` parameter is retained for signature compatibility with
 * existing callers but is unused.
 */
async function getProviderConfigs(tenantId: string, _userId?: string): Promise<ProviderConfig[]> {
  const { readProviders } = await import('@/src/lib/k8s/provider-storage');
  return readProviders(tenantId);
}

/** Persist the provider list back to the tenant's Secret. */
async function saveProviderConfigs(tenantId: string, providers: ProviderConfig[], _userId?: string): Promise<void> {
  const { writeProviders } = await import('@/src/lib/k8s/provider-storage');
  await writeProviders(tenantId, providers);
}

/** Convert the internal config shape to the public-facing ProviderRecord. */
function configToRecord(cfg: ProviderConfig): ProviderRecord {
  const masked =
    cfg.apiKey.length > 8
      ? `${cfg.apiKey.slice(0, 4)}${'*'.repeat(cfg.apiKey.length - 8)}${cfg.apiKey.slice(-4)}`
      : cfg.apiKey.length > 0
        ? '****'
        : '';
  return {
    name: cfg.name,
    displayName: cfg.name,
    type: cfg.type,
    // Never expose the raw key in the public record.
    apiKeyMasked: masked,
    baseUrl: cfg.baseUrl,
    defaultModel: cfg.model,
    isDefault: cfg.isDefault ?? false,
    isEnabled: cfg.enabled,
    version: 1,
    createdAt: cfg.createdAt ?? new Date().toISOString(),
    updatedAt: cfg.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * List all LLM provider configurations for a tenant.
 *
 * Providers are stored as a JSON array in the tenant config under the
 * `providers` key. The returned {@link ProviderRecord} objects never expose
 * raw API key material — only a masked representation is included.
 */
export async function listProviders(tenantId: string, userId?: string): Promise<ListProvidersResult> {
  const configs = await getProviderConfigs(tenantId, userId);
  const records = configs.map(configToRecord);
  const defaultProvider = configs.find((c) => c.isDefault)?.name ?? null;
  const fallbackChain = configs
    .filter((c) => c.enabled && !c.isDefault)
    .map((c) => c.name);
  return { providers: records, defaultProvider, fallbackChain };
}

/**
 * Create a new provider configuration for a tenant.
 *
 * The `input` object must supply at minimum: `name`, `type`, `apiKey`, and
 * `model`. If `isDefault` is true all other providers are demoted atomically
 * in the same write.
 */
export async function createProvider(
  tenantId: string,
  input: Record<string, unknown>,
  userId?: string
): Promise<ProviderRecord> {
  const configs = await getProviderConfigs(tenantId, userId);
  const now = new Date().toISOString();

  if (configs.some((c) => c.name === (input['name'] as string))) {
    throw new Error(`Provider '${input['name']}' already exists`);
  }

  const newConfig: ProviderConfig = {
    name: input['name'] as string,
    type: input['type'] as ProviderConfig['type'],
    apiKey: (input['apiKey'] as string | undefined) ?? '',
    model: (input['model'] as string | undefined) ?? '',
    baseUrl: input['baseUrl'] as string | undefined,
    isDefault: (input['isDefault'] as boolean | undefined) ?? false,
    enabled: (input['enabled'] as boolean | undefined) ?? true,
    createdAt: now,
    updatedAt: now,
  };

  let updated = [...configs];
  if (newConfig.isDefault) {
    updated = updated.map((c) => ({ ...c, isDefault: false }));
  }
  updated.push(newConfig);

  await saveProviderConfigs(tenantId, updated, userId);
  return configToRecord(newConfig);
}

/**
 * Retrieve a single provider by name.
 *
 * Throws if no provider with the given name exists for the tenant.
 */
export async function getProvider(tenantId: string, name: string, userId?: string): Promise<ProviderRecord> {
  const configs = await getProviderConfigs(tenantId, userId);
  const cfg = configs.find((c) => c.name === name);
  if (!cfg) throw new Error(`Provider '${name}' not found`);
  return configToRecord(cfg);
}

/**
 * Apply partial updates to an existing provider.
 *
 * When `apiKey` is omitted or empty the stored key is preserved unchanged.
 * Setting `isDefault: true` demotes all other providers atomically in the
 * same write.
 */
export async function updateProvider(
  tenantId: string,
  name: string,
  input: Record<string, unknown>,
  userId?: string
): Promise<ProviderRecord> {
  const configs = await getProviderConfigs(tenantId, userId);
  const idx = configs.findIndex((c) => c.name === name);
  if (idx === -1) throw new Error(`Provider '${name}' not found`);

  const now = new Date().toISOString();
  const existing = configs[idx];
  const makingDefault = (input['isDefault'] as boolean | undefined) ?? existing.isDefault;

  let updated = configs.map((c, i) => {
    if (makingDefault && i !== idx) return { ...c, isDefault: false };
    return c;
  });

  updated[idx] = {
    ...existing,
    type: (input['type'] as ProviderConfig['type'] | undefined) ?? existing.type,
    // Only overwrite the stored key when a non-empty replacement is supplied.
    apiKey:
      typeof input['apiKey'] === 'string' && input['apiKey'].length > 0
        ? input['apiKey']
        : existing.apiKey,
    model: (input['model'] as string | undefined) ?? existing.model,
    baseUrl:
      input['baseUrl'] !== undefined
        ? (input['baseUrl'] as string | undefined)
        : existing.baseUrl,
    isDefault: makingDefault,
    enabled: (input['enabled'] as boolean | undefined) ?? existing.enabled,
    updatedAt: now,
  };

  await saveProviderConfigs(tenantId, updated, userId);
  return configToRecord(updated[idx]);
}

/**
 * Permanently remove a provider configuration.
 *
 * Throws if the named provider does not exist. If the deleted provider was the
 * default, no other provider is automatically promoted — callers should call
 * {@link setDefaultProvider} explicitly if needed.
 */
export async function deleteProvider(tenantId: string, name: string, userId?: string): Promise<void> {
  const configs = await getProviderConfigs(tenantId, userId);
  const filtered = configs.filter((c) => c.name !== name);
  if (filtered.length === configs.length) {
    throw new Error(`Provider '${name}' not found`);
  }
  await saveProviderConfigs(tenantId, filtered, userId);
}

/**
 * Return the name of the tenant's current default provider, or null if none
 * has been designated.
 */
export async function getDefaultProvider(tenantId: string, userId?: string): Promise<{ name: string } | null> {
  const configs = await getProviderConfigs(tenantId, userId);
  const def = configs.find((c) => c.isDefault);
  return def ? { name: def.name } : null;
}

/**
 * Designate a provider as the tenant's default.
 *
 * All other providers are demoted atomically in the same write.
 * Throws if the named provider does not exist.
 */
export async function setDefaultProvider(tenantId: string, name: string, userId?: string): Promise<void> {
  const configs = await getProviderConfigs(tenantId, userId);
  const target = configs.find((c) => c.name === name);
  if (!target) throw new Error(`Provider '${name}' not found`);
  const updated = configs.map((c) => ({ ...c, isDefault: c.name === name }));
  await saveProviderConfigs(tenantId, updated, userId);
}

// ---------------------------------------------------------------------------
// Provider connectivity test helpers
// ---------------------------------------------------------------------------

/**
 * Issue a lightweight liveness probe to an Anthropic endpoint using the
 * Messages API with a minimal single-token prompt.
 *
 * HTTP 400 is treated as success — it means the API correctly parsed the
 * request (key is valid) even if the exact model name is unrecognised.
 */
async function testAnthropicProvider(apiKey: string): Promise<ProviderTestResult> {
  const start = Date.now();
  const testedAt = new Date().toISOString();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const latencyMs = Date.now() - start;
    if (res.ok || res.status === 400) {
      return { success: true, latencyMs, testedAt };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      success: false,
      latencyMs,
      error: body['error'] ? JSON.stringify(body['error']) : `HTTP ${res.status}`,
      testedAt,
    };
  } catch (err: unknown) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      testedAt,
    };
  }
}

/**
 * Issue a lightweight liveness probe to the OpenAI API by listing models.
 */
async function testOpenAIProvider(apiKey: string): Promise<ProviderTestResult> {
  const start = Date.now();
  const testedAt = new Date().toISOString();
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { success: true, latencyMs, testedAt };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      success: false,
      latencyMs,
      error: body['error'] ? JSON.stringify(body['error']) : `HTTP ${res.status}`,
      testedAt,
    };
  } catch (err: unknown) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      testedAt,
    };
  }
}

/**
 * Issue a lightweight liveness probe to the Google Generative Language API
 * by listing available models with the provided API key.
 */
async function testGoogleProvider(apiKey: string): Promise<ProviderTestResult> {
  const start = Date.now();
  const testedAt = new Date().toISOString();
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { success: true, latencyMs, testedAt };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      success: false,
      latencyMs,
      error: body['error'] ? JSON.stringify(body['error']) : `HTTP ${res.status}`,
      testedAt,
    };
  } catch (err: unknown) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      testedAt,
    };
  }
}

/**
 * Issue a lightweight liveness probe to an Ollama instance via its
 * `/api/tags` endpoint.
 */
async function testOllamaProvider(baseUrl: string): Promise<ProviderTestResult> {
  const start = Date.now();
  const testedAt = new Date().toISOString();
  const normalized = baseUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${normalized}/api/tags`);
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { success: true, latencyMs, testedAt };
    }
    return { success: false, latencyMs, error: `HTTP ${res.status}`, testedAt };
  } catch (err: unknown) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      testedAt,
    };
  }
}

/**
 * Test connectivity to a provider.
 *
 * Accepts either the name of an existing stored provider (string) or an
 * ad-hoc config object (same shape as `ProviderConfig`). In both cases a
 * real network request is made to the provider's API to verify credentials
 * and measure round-trip latency.
 *
 * @returns `{ success, latencyMs, error?, testedAt }`
 */
export async function testProvider(
  tenantId: string,
  nameOrInput: string | Record<string, unknown>,
  userId?: string
): Promise<ProviderTestResult> {
  let cfg: ProviderConfig;

  if (typeof nameOrInput === 'string') {
    const configs = await getProviderConfigs(tenantId, userId);
    const found = configs.find((c) => c.name === nameOrInput);
    if (!found) throw new Error(`Provider '${nameOrInput}' not found`);
    cfg = found;
  } else {
    cfg = {
      name: (nameOrInput['name'] as string | undefined) ?? '',
      type: nameOrInput['type'] as ProviderConfig['type'],
      apiKey: (nameOrInput['apiKey'] as string | undefined) ?? '',
      model: (nameOrInput['model'] as string | undefined) ?? '',
      baseUrl: nameOrInput['baseUrl'] as string | undefined,
      enabled: true,
    };
  }

  switch (cfg.type) {
    case 'anthropic':
      return testAnthropicProvider(cfg.apiKey);
    case 'openai':
      return testOpenAIProvider(cfg.apiKey);
    case 'google':
      return testGoogleProvider(cfg.apiKey);
    case 'ollama':
      return testOllamaProvider(cfg.baseUrl ?? 'http://localhost:11434');
    default: {
      const _exhaustive: never = cfg.type;
      return {
        success: false,
        latencyMs: 0,
        error: `Unknown provider type: ${String(_exhaustive)}`,
        testedAt: new Date().toISOString(),
      };
    }
  }
}

/**
 * Check the health of all enabled providers for a tenant concurrently.
 *
 * Each enabled provider is probed via {@link testProvider}. If `name` is
 * supplied only that specific provider is checked.
 *
 * @returns A map of provider name to `{ status, latencyMs, lastCheckAt?, error? }`.
 */
export async function getProviderHealth(
  tenantId: string,
  name?: string,
  userId?: string
): Promise<Record<string, { status: string; latencyMs?: number; lastCheckAt?: string; error?: string }>> {
  const configs = await getProviderConfigs(tenantId, userId);
  const targets = name
    ? configs.filter((c) => c.name === name)
    : configs.filter((c) => c.enabled);

  const results = await Promise.all(
    targets.map(async (cfg) => {
      const result = await testProvider(tenantId, cfg.name, userId);
      return [
        cfg.name,
        {
          status: result.success ? 'healthy' : 'unhealthy',
          latencyMs: result.latencyMs,
          lastCheckAt: result.testedAt,
          ...(result.error ? { error: result.error } : {}),
        },
      ] as const;
    })
  );

  return Object.fromEntries(results);
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
export async function listAvailablePlugins(tenantId: string, userId?: string, tenantCtx?: string): Promise<PluginInfo[]> {
  const response = await listPlugins(userId, tenantCtx);
  return response.plugins ?? [];
}

// listTenantPlugins / enable*/disable* / get*/updatePluginConfig removed —
// these previously stored per-tenant flags inside the daemon's tenant config
// map. Tenant config is now owned by the Tenant CRD; equivalent flag/config
// management lives in `app/actions/crd/tenant.ts`.

/**
 * Probe plugin health via the daemon QueryPlugin RPC (method="health").
 *
 * Returns `{ success: true, latencyMs }` on success, or
 * `{ success: false, error, latencyMs }` on any failure without throwing.
 */
export async function testPluginConnection(
  tenantId: string,
  name: string,
  _config?: Record<string, string>,
  userId?: string
): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
  const client = getClient(userId, tenantId);
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

// updatePluginAccess removed — plugin read/write access flags are now
// managed via the Tenant CRD. See `app/actions/crd/tenant.ts`.

// ============================================================================
// Team Management
//
// Team-scoped helpers (listTeamMembers / updateMemberRole / removeMember) have
// been removed. Member management now flows through the TenantMember CRD via
// `app/actions/crd/member.ts` and `useCRDWatch("TenantMember", ns)`.
// ============================================================================

/**
 * Retrieves active sessions for a user via the daemon GetUserSessions RPC.
 */
export async function listUserSessions(
  tenantId: string,
  userId: string,
  callerUserId?: string
): Promise<ListUserSessionsResponse> {
  const client = getAdminClient(callerUserId, tenantId);
  try {
    const resp = await client.getUserSessions({ tenantId, userId });
    const sessions: UserSession[] = (resp.sessions ?? []).map((s) => ({
      id: s.id,
      userId,
      deviceInfo: { deviceType: 'unknown' as const },
      ipAddress: s.ipAddress,
      location: undefined,
      createdAt: new Date(Number(s.startedAtUnix) * 1000).toISOString(),
      lastActiveAt: new Date(Number(s.lastActiveAtUnix) * 1000).toISOString(),
      expiresAt: undefined,
      isCurrent: false,
    }));
    return { sessions, total: sessions.length };
  } catch (err) {
    console.error('listUserSessions: daemon RPC failed', err);
    return { sessions: [], total: 0 };
  }
}

// ============================================================================
// User Profile — daemon-RPC backed
//
// All user identity operations (profile, sessions, activity) go through
// daemon RPCs. The daemon delegates to Better Auth in the dashboard for the
// underlying user store.
// ============================================================================

/**
 * Fetch a user's profile via the daemon GetUserProfile RPC and map it to the UserProfile shape.
 */
export async function getUserProfile(
  tenantId: string,
  userId: string
): Promise<UserProfile> {
  const client = getAdminClient();
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
 * Apply partial profile updates via the daemon UpdateUserProfile RPC.
 * Only display_name and avatar_url are accepted; email and roles cannot be
 * changed through this endpoint (enforced by the daemon).
 */
export async function updateUserProfile(
  tenantId: string,
  userId: string,
  updates: Record<string, unknown>
): Promise<UserProfile> {
  const client = getAdminClient();
  const resp = await client.updateUserProfile({
    tenantId,
    userId,
    displayName: typeof updates.displayName === 'string' ? updates.displayName : '',
    avatarUrl: typeof updates.avatarUrl === 'string' ? updates.avatarUrl : '',
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
 * Retrieve user activity via the daemon's ListAuditEvents RPC.
 *
 * Events are filtered by actorUserId and mapped to UserActivity records.
 * Unrecognised event types fall back to `settings_change`. On any failure
 * an empty result set is returned so callers degrade gracefully.
 */
export async function getUserActivity(
  tenantId: string,
  userId: string,
  opts?: { page?: number; limit?: number }
): Promise<ListUserActivitiesResponse> {
  const limit = Math.min(opts?.limit ?? 20, 100);
  // Note: page-based offset is not directly supported by ListAuditEvents; we
  // return up to `limit` results from the most recent events.
  const _first = ((opts?.page ?? 1) - 1) * limit;

  // getUserActivity uses the daemon's ListAuditEvents RPC to surface user-level activity.
  let rawEvents: Array<Record<string, unknown>>;
  try {
    const client = getAdminClient();
    const auditResp = await client.listAuditEvents({
      tenantId,
      actorUserId: userId,
      limit,
      fromTime: '',
      toTime: '',
      eventTypes: [],
    });
    rawEvents = (auditResp.events ?? []).map((e) => ({
      id: e.traceId,
      type: e.eventType,
      time: new Date(e.timestamp).getTime(),
      userId,
      ipAddress: '',
      details: e.details ?? {},
    }));
  } catch (err) {
    console.error('getUserActivity: audit query failed', err);
    return { activities: [], total: 0, page: opts?.page ?? 1, limit, hasMore: false };
  }

  // Map audit event type strings to UserActivityType values.
  const eventTypeMap: Record<string, UserActivity['type']> = {
    LOGIN: 'login',
    LOGOUT: 'logout',
    UPDATE_PROFILE: 'profile_updated',
    UPDATE_PASSWORD: 'password_changed',
    UPDATE_TOTP: 'mfa_enabled',
    REMOVE_TOTP: 'mfa_disabled',
  };

  const activities: UserActivity[] = rawEvents.map((ev) => {
    const rawType = typeof ev.type === 'string' ? (ev.type as string) : '';
    const activityType: UserActivity['type'] = eventTypeMap[rawType] ?? 'settings_change';
    const ts =
      typeof ev.time === 'number'
        ? new Date(ev.time).toISOString()
        : new Date().toISOString();

    return {
      id: typeof ev.id === 'string' ? ev.id : `${ts}-${Math.random()}`,
      userId: typeof ev.userId === 'string' ? ev.userId : userId,
      type: activityType,
      description: rawType || 'Activity event',
      timestamp: ts,
      metadata: (ev.details ?? {}) as Record<string, unknown>,
      ipAddress: typeof ev.ipAddress === 'string' ? ev.ipAddress : undefined,
    };
  });

  return {
    activities,
    total: activities.length,
    page: opts?.page ?? 1,
    limit,
    hasMore: activities.length === limit,
  };
}

// Invitation RPCs (ListInvitations / RevokeInvitation / ResendInvitation /
// CreateInvitation) have moved to the TenantMember CRD — see
// `app/actions/crd/member.ts` (inviteMemberAction / resendInvitationAction /
// revokeMemberAction).

// ============================================================================
// Analytics — computed from daemon RPCs and Neo4j graph
// ============================================================================

import { getNeo4jDriver } from '@/src/lib/neo4j-client';

export interface KPIs {
  activeMissions: number;
  totalMissions: number;
  agentsOnline: number;
  totalAgents: number;
  totalTools: number;
  totalFindings: number;
  criticalFindings: number;
}

/**
 * Return high-level operational KPIs by combining daemon RPC data with a
 * Neo4j finding count query.
 *
 * Neo4j failures are handled gracefully — finding counts fall back to zero
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
    const driver = getNeo4jDriver();
    const session = driver.session({ database: 'neo4j' });
    try {
      const result = await session.run(
        `MATCH (f:Finding)
         WHERE f.tenant_id = $tenantId OR $tenantId IS NULL
         RETURN count(f) AS total,
                count(CASE WHEN f.severity = 'critical' THEN 1 END) AS critical`,
        { tenantId: tenantId || null }
      );
      if (result.records.length > 0) {
        const rec = result.records[0];
        const rawTotal = rec.get('total');
        const rawCritical = rec.get('critical');
        totalFindings =
          rawTotal && typeof rawTotal.toNumber === 'function'
            ? rawTotal.toNumber()
            : Number(rawTotal ?? 0);
        criticalFindings =
          rawCritical && typeof rawCritical.toNumber === 'function'
            ? rawCritical.toNumber()
            : Number(rawCritical ?? 0);
      }
    } finally {
      await session.close();
    }
  } catch (err) {
    console.warn('getKPIs: Neo4j query failed, finding counts will be 0', err);
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
 * Return finding counts grouped by severity from Neo4j.
 *
 * Returns an empty object on Neo4j connection failure so the caller can
 * degrade gracefully rather than surface an error to the UI.
 */
export async function getFindingsBySeverity(tenantId: string, _userId?: string): Promise<Record<string, number>> {
  try {
    const driver = getNeo4jDriver();
    const session = driver.session({ database: 'neo4j' });
    try {
      const result = await session.run(
        `MATCH (f:Finding)
         WHERE f.tenant_id = $tenantId OR $tenantId IS NULL
         RETURN f.severity AS severity, count(f) AS count`,
        { tenantId: tenantId || null }
      );
      const counts: Record<string, number> = {};
      for (const rec of result.records) {
        const severity = rec.get('severity') as string | null;
        const raw = rec.get('count');
        const count =
          raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw ?? 0);
        counts[severity ?? 'unknown'] = count;
      }
      return counts;
    } finally {
      await session.close();
    }
  } catch (err) {
    console.warn('getFindingsBySeverity: Neo4j query failed', err);
    return {};
  }
}

/**
 * Return finding counts grouped by category (f.type) from Neo4j.
 *
 * Returns an empty object on Neo4j connection failure.
 */
export async function getFindingsByCategory(tenantId: string, _userId?: string): Promise<Record<string, number>> {
  try {
    const driver = getNeo4jDriver();
    const session = driver.session({ database: 'neo4j' });
    try {
      const result = await session.run(
        `MATCH (f:Finding)
         WHERE f.tenant_id = $tenantId OR $tenantId IS NULL
         RETURN f.type AS category, count(f) AS count`,
        { tenantId: tenantId || null }
      );
      const counts: Record<string, number> = {};
      for (const rec of result.records) {
        const category = rec.get('category') as string | null;
        const raw = rec.get('count');
        const count =
          raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw ?? 0);
        counts[category ?? 'unknown'] = count;
      }
      return counts;
    } finally {
      await session.close();
    }
  } catch (err) {
    console.warn('getFindingsByCategory: Neo4j query failed', err);
    return {};
  }
}

export interface FindingsTimeSeriesPoint {
  date: string;
  count: number;
}

/**
 * Return a daily time series of finding counts over the past `days` days.
 *
 * Returns an empty array on Neo4j connection failure.
 */
export async function getFindingsTimeSeries(
  tenantId: string,
  days = 30,
  _userId?: string
): Promise<FindingsTimeSeriesPoint[]> {
  try {
    const driver = getNeo4jDriver();
    const session = driver.session({ database: 'neo4j' });
    try {
      const result = await session.run(
        `MATCH (f:Finding)
         WHERE (f.tenant_id = $tenantId OR $tenantId IS NULL)
           AND f.created_at > datetime() - duration({days: $days})
         RETURN date(f.created_at) AS date, count(f) AS count
         ORDER BY date`,
        { tenantId: tenantId || null, days }
      );
      return result.records.map((rec) => {
        const raw = rec.get('count');
        const count =
          raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw ?? 0);
        const dateVal = rec.get('date');
        // Neo4j Date objects expose .toString() as ISO date strings (YYYY-MM-DD)
        const dateStr =
          dateVal && typeof dateVal.toString === 'function'
            ? dateVal.toString()
            : String(dateVal ?? '');
        return { date: dateStr, count };
      });
    } finally {
      await session.close();
    }
  } catch (err) {
    console.warn('getFindingsTimeSeries: Neo4j query failed', err);
    return [];
  }
}

export interface MissionHeatmapCell {
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

export interface AgentPerformanceRecord {
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

// initiateSignup / getProvisioningStatusByUser removed — signup and
// provisioning lifecycle moved to the Tenant CRD operator. See
// `app/actions/crd/tenant.ts` for the equivalent CRD-backed flow.

// Member invitation and removal now flow through `app/actions/crd/member.ts`
// against the TenantMember CRD.

// Agent Auth RPCs (RegisterAgentAuth / ExecuteAgentCapability / ListAgentCapabilities
// / GetAgentAuthStatus / RevokeAgentAuth / ListAgentAuthAgents /
// CreateHostRegistrationToken) have moved to the AgentEnrollment CRD — see
// `app/actions/crd/enrollment.ts`.
