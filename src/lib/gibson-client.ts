import 'server-only';
import { createClient, ConnectError, Code } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { auth } from '@/auth';
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
  UserSession,
  ListUserSessionsResponse,
  UserProfile,
  UserActivity,
  ListUserActivitiesResponse,
} from '@/src/types/user';
import { serverConfig as _serverConfig } from './config';
import { getSpiffeJwt } from './spiffe/jwt-svid';
// NOTE(spec in-cluster-mtls-restoration Phase 5): the X.509 SVID direct mTLS
// transport (Track A) was removed in Task 16. The `dashboard.useEnvoyForDaemon`
// flag (env var USE_ENVOY_FOR_DAEMON) is retained as documented backout
// (Requirement 6.1) but its `false` branch is now a hard error — the only
// transport in this file dials Envoy with a JWT-SVID. To revert Phase 5 in a
// hot patch, restore the X.509 SVID branch from git history (see Task 16
// commit) AND set the env to "false". Phase 9 removes the flag entirely.
//
// `serverConfig.gibsonDaemonUrl` is still imported (aliased _serverConfig) so
// that the build doesn't dead-strip it before Phase 9 — exporters elsewhere
// in the dashboard still reference `gibsonDaemonUrl` indirectly.
void _serverConfig;

// Tenant CRUD/lookup has moved to the Tenant CRD operator. Use
// `@/src/lib/k8s/tenants` for tenant access. Tenant proto types are no
// longer exported by this module.

// ---------------------------------------------------------------------------
// Spec in-cluster-mtls-restoration: Track B-only (post Phase 5 teardown)
// ---------------------------------------------------------------------------
//
// All daemon RPCs flow through Envoy at ADMIN_ENVOY_BASE_URL with a
// JWT-SVID (audience spiffe://gibson.io/platform/daemon) minted via the
// SPIRE Workload API. Mirrors gibson-admin-client.ts's transport model.
//
// Envoy validates the JWT-SVID, ext-authz mints the HMAC-signed
// x-gibson-identity-* headers, and the daemon accepts the request based on
// those headers exclusively. The daemon's mTLS listener accepts ONLY
// connections from spiffe://gibson.io/platform/envoy.
//
// USE_ENVOY_FOR_DAEMON=false is a documented backout (Requirement 6.1). After
// Phase 5 it produces an explicit error rather than a silent fallback to the
// (now-deleted) direct mTLS path. Reverting requires un-deleting Task 16's
// changes in a hot patch.

/** Envoy edge URL — mirrors gibson-admin-client.ts. */
const ENVOY_BASE_URL =
  process.env['ADMIN_ENVOY_BASE_URL'] ?? 'https://api.zero-day.local:30443';

/**
 * SPIFFE audience claim on the JWT-SVID. Must match the `audiences` list
 * configured on Envoy's `spiffe` provider in envoy.yaml. Envoy verifies the
 * audience; the daemon does not (Envoy is the authoritative validator).
 */
const DAEMON_AUDIENCE =
  process.env['GIBSON_DAEMON_SPIFFE_AUDIENCE'] ??
  'spiffe://gibson.io/platform/daemon';

/**
 * Backout-flag check. After Phase 5 (Task 16) the flag's only legal value is
 * "true" or unset. "false" produces a hard error pointing at the revert path.
 * Phase 9 deletes the flag + this guard entirely.
 */
function assertEnvoyPath(): void {
  if (process.env['USE_ENVOY_FOR_DAEMON'] === 'false') {
    throw new ConnectError(
      'USE_ENVOY_FOR_DAEMON=false but the direct daemon mTLS path was deleted by ' +
        'spec in-cluster-mtls-restoration Phase 5 (Task 16). To revert, restore the ' +
        'X.509 SVID branch from git history and redeploy.',
      Code.FailedPrecondition,
    );
  }
}

/**
 * Resolve the Zitadel access token from the current Auth.js session.
 *
 * Throws a {@link ConnectError} with code {@link Code.Unauthenticated} when
 * the session is missing. The token itself is NOT forwarded to Envoy —
 * Envoy's ext-authz validates the JWT-SVID and mints HMAC identity headers
 * from that alone. We still resolve the session so unauthenticated requests
 * fail closed before any SVID minting work happens.
 */
async function requireAuthSession(): Promise<void> {
  const session = await auth();
  if (!session?.accessToken) {
    throw new ConnectError(
      'No Zitadel access token in session — user must be signed in via Zitadel OIDC',
      Code.Unauthenticated,
    );
  }
}

/**
 * Build the Envoy-routed gRPC transport. Lazily mints a JWT-SVID per request
 * via the cached `getSpiffeJwt` helper.
 */
function getTransport() {
  const interceptors: Parameters<typeof createGrpcTransport>[0]['interceptors'] = [
    (next) => async (req) => {
      const jwt = await getSpiffeJwt({ audience: DAEMON_AUDIENCE });
      req.header.set('Authorization', `Bearer ${jwt}`);
      return next(req);
    },
  ];

  return createGrpcTransport({
    baseUrl: ENVOY_BASE_URL,
    interceptors,
  });
}

async function getClient(_userId?: string, _tenantId?: string) {
  assertEnvoyPath();
  await requireAuthSession();
  return createClient(DaemonService, getTransport());
}

async function getAdminClient(_userId?: string, _tenantId?: string) {
  assertEnvoyPath();
  await requireAuthSession();
  return createClient(DaemonAdminService, getTransport());
}

// ---------------------------------------------------------------------------
// LLM user-attribution-governance clients (spec: llm-user-attribution-governance)
// ---------------------------------------------------------------------------

export async function getBudgetClient() {
  assertEnvoyPath();
  await requireAuthSession();
  const { BudgetService } = await import("@/src/gen/gibson/budget/v1/budget_pb");
  return createClient(BudgetService, getTransport());
}

export async function getModelAccessClient() {
  assertEnvoyPath();
  await requireAuthSession();
  const { ModelAccessService } = await import(
    "@/src/gen/gibson/authz/v1/model_access_pb"
  );
  return createClient(ModelAccessService, getTransport());
}

export async function getUsageClient() {
  assertEnvoyPath();
  await requireAuthSession();
  const { UsageService } = await import("@/src/gen/gibson/usage/v1/usage_pb");
  return createClient(UsageService, getTransport());
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

export async function getMissionHistory(name: string, limit = 100, offset = 0, userId?: string, tenantId?: string) {
  const client = await getClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
  const response = await client.listAPIKeys({ tenantId });
  return response.keys ?? [];
}

/**
 * Permanently revoke an API key.  The key cannot be recovered after revocation.
 */
export async function revokeAPIKey(tenantId: string, keyId: string, userId?: string): Promise<void> {
  const client = await getAdminClient(userId, tenantId);
  await client.revokeAPIKey({ keyId });
}

// listUserTenants / MembershipInfo removed — tenant membership is now
// served by the Tenant CRD operator (see @/src/lib/k8s/tenants).

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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(callerUserId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
  const client = await getAdminClient(callerUserId, tenantId);
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
  const client = await getAdminClient(callerUserId, tenantId);
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
  const client = await getAdminClient(userId, tenantId);
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
// Provider Management — thin wrappers over the daemon gRPC client
//
// spec 25-daemon-driven-provider-config (task 15): the legacy K8s Secret
// storage layer (provider-storage.ts) has been deleted. Every provider
// operation now routes through the DaemonAdminService RPCs. The exported
// function signatures are preserved so existing callers keep working without
// changes; the internal helpers (getProviderConfigs, saveProviderConfigs,
// configToRecord, per-type testXxxProvider) have been removed along with
// the K8s-backed implementations.
//
// The daemon* prefixed functions added in task 9 remain as the canonical
// implementations — they are called directly by the task-11 route handlers,
// the task-10 GibsonLLMAdapter, and the thin wrappers below.
// ============================================================================

/**
 * Legacy-compatible read shape for a provider record.
 * @deprecated Prefer {@link DaemonProviderRecord} for new code.
 */
export interface ProviderRecord {
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
export interface ListProvidersResult {
  providers: ProviderRecord[];
  defaultProvider: string | null;
  fallbackChain: string[];
}

/**
 * List all LLM provider configurations for a tenant.
 *
 * Thin wrapper over {@link daemonListProviders} + {@link daemonGetFallbackChain}.
 * Credentials are never returned — only masked values are included.
 */
export async function listProviders(tenantId: string, userId?: string): Promise<ListProvidersResult> {
  const [records, fallbackChain] = await Promise.all([
    daemonListProviders(userId, tenantId),
    daemonGetFallbackChain(userId, tenantId).catch(() => [] as string[]),
  ]);

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

  return { providers, defaultProvider, fallbackChain };
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
  const client = await getAdminClient(callerUserId, tenantId);
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
  const client = await getAdminClient();
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
  const client = await getAdminClient();
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
    const client = await getAdminClient();
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

// Capability Grant RPCs (RegisterCapabilityGrant / ExecuteAgentCapability / ListAgentCapabilities
// / GetCapabilityGrantStatus / RevokeCapabilityGrant / ListCapabilityGrantAgents /
// CreateHostRegistrationToken) have moved to the AgentEnrollment CRD — see
// `app/actions/crd/enrollment.ts`.

// ---------------------------------------------------------------------------
// Supported LLM providers (introspection for dashboard form rendering)
// ---------------------------------------------------------------------------

/**
 * Credential field descriptor returned by the daemon's GetSupportedProviders
 * RPC. One entry per input the operator must supply in the provider form.
 */
export interface CredentialFieldDescriptor {
  /** ProviderConfig.Extra map key the daemon resolver reads ("api_key" / "base_url" for typed fields). */
  key: string;
  /** Human-facing form label. */
  label: string;
  /** Mandatory-for-construction flag. */
  required: boolean;
  /** Render as password input; mask in logs and audit records. */
  secret: boolean;
  /** Example value for the empty input. */
  placeholder: string;
  /** Short description rendered beneath the field. */
  help: string;
}

/**
 * Model descriptor returned per provider so the dashboard can populate a
 * model picker without constructing the provider.
 */
export interface ModelDescriptor {
  name: string;
  contextWindow: number;
  maxOutput: number;
  features: string[];
}

/**
 * Supported LLM provider descriptor — the client-side shape of the daemon's
 * ProviderDescriptor proto message.
 */
export interface SupportedProviderDescriptor {
  /** Provider type identifier (e.g. "bedrock", "openai"). */
  type: string;
  /** Human-facing label shown in the dashboard dropdown. */
  displayName: string;
  /** Upstream provider's credential/setup docs. */
  docsUrl: string;
  /** True for providers running on operator-controlled infrastructure. */
  selfHosted: boolean;
  /** Form schema — one entry per credential input. */
  credentials: CredentialFieldDescriptor[];
  /** Default model catalogue the provider advertises. */
  defaultModels: ModelDescriptor[];
}

/**
 * Fetch the full list of LLM provider types the daemon can construct, with
 * per-provider credential schemas and default model catalogues. The dashboard
 * uses this to render the Settings > Providers form dynamically — no
 * hard-coded frontend provider list, no drift between daemon and UI.
 *
 * The daemon RPC is gated to any authenticated tenant member; it returns
 * only descriptor metadata (no secrets, no tenant-specific data).
 */
export async function getSupportedProviders(
  userId?: string,
  tenantId?: string,
): Promise<SupportedProviderDescriptor[]> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.getSupportedProviders({});
  return (resp.providers ?? []).map((p) => ({
    type: p.type,
    displayName: p.displayName,
    docsUrl: p.docsUrl,
    selfHosted: p.selfHosted,
    credentials: (p.credentials ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      secret: f.secret,
      placeholder: f.placeholder,
      help: f.help,
    })),
    defaultModels: (p.defaultModels ?? []).map((m) => ({
      name: m.name,
      contextWindow: m.contextWindow,
      maxOutput: m.maxOutput,
      features: [...(m.features ?? [])],
    })),
  }));
}

// ============================================================================
// Daemon-backed Provider Config (spec 25-daemon-driven-provider-config)
//
// These functions call the new DaemonAdminService provider-config RPCs that
// landed in spec 25. They follow the exact same pattern as getSupportedProviders
// above: getAdminClient(userId, tenantId) → RPC → friendly camelCased shape.
//
// NOTE ON NAMING: The existing K8s-backed helpers further up this file share
// the same base names (listProviders, createProvider, etc.) with `tenantId`
// as the required first argument. To avoid a TypeScript duplicate-export error
// without modifying those functions (task 9 restriction), the new daemon-backed
// variants are prefixed with `daemon`. Task 15 will delete the K8s-backed
// functions and rename these to drop the prefix so callers see no change.
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
}

/**
 * Write-side shape for creating or updating a daemon-managed LLM provider.
 * Credentials are plaintext on the wire; the daemon encrypts them immediately
 * via AES-256-GCM + KeyProvider and never persists the plaintext.
 *
 * Prefixed `Daemon` to avoid collision with the legacy ProviderConfigInput
 * from src/types/provider.ts.
 */
export interface DaemonProviderConfigInput {
  /** Tenant-scoped human name. */
  name: string;
  /** Provider type identifier (e.g. "anthropic", "openai"). */
  type: string;
  /** Model to use when none is specified by the caller. */
  defaultModel: string;
  /** Plaintext credentials, e.g. {"api_key": "sk-..."}. Transient — not retained by dashboard. */
  credentials: Record<string, string>;
  /** When true, atomically designates this provider as the tenant's default. */
  setAsDefault?: boolean;
}

/**
 * Structured result of a daemon-side provider connectivity test.
 * Note: latencyMs is returned as number here (converted from proto int64 bigint).
 */
export interface DaemonProviderTestResult {
  /** True when the upstream returned a successful response. */
  ok: boolean;
  /** Round-trip time in milliseconds (always reported, even on failure). */
  latencyMs: number;
  /** Model used for the test completion (when ok is true). */
  model: string;
  /** Cleaned upstream error message (when ok is false). */
  error?: string;
}

/**
 * Health status for a daemon-managed provider.
 */
export interface DaemonProviderHealthStatus {
  status: 'healthy' | 'unhealthy' | 'unknown';
  /** RFC 3339 timestamp of the last health check. */
  lastCheckAt?: string;
  /** Error message when status is unhealthy. */
  lastError?: string;
}

// ---------------------------------------------------------------------------
// LLM execution types (spec 25 §5 — GibsonLLMAdapter inputs/outputs)
// ---------------------------------------------------------------------------

/**
 * A single message in a conversation sent to executeLLM / streamLLM.
 * Maps to the proto gibson.daemon.admin.v1.LLMMessageContent.
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
 * Maps to the proto gibson.daemon.admin.v1.LLMToolDef.
 */
export interface DaemonLLMToolDef {
  name: string;
  description: string;
  /** JSON-encoded JSON Schema for the tool arguments. */
  parametersJson: string;
}

/**
 * A tool invocation requested by the LLM.
 * Maps to the proto gibson.daemon.admin.v1.LLMToolCall.
 */
export interface DaemonLLMToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments string. */
  arguments: string;
}

/**
 * The output of a tool call.
 * Maps to the proto gibson.daemon.admin.v1.LLMToolResult.
 */
export interface DaemonLLMToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

/**
 * Token usage reported for an LLM completion.
 * Maps to the proto gibson.daemon.admin.v1.LLMTokenUsage.
 */
export interface DaemonLLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Controls the structure of the LLM's output.
 * Maps to the proto gibson.daemon.admin.v1.ResponseFormat.
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
 * Incremental tool-call delta in a streaming response.
 * Maps to the proto gibson.daemon.admin.v1.ToolCallDelta.
 */
export interface DaemonToolCallDelta {
  /** 0-based index identifying which tool call this delta belongs to. */
  index: number;
  /** Tool call identifier (present on the first delta for this index). */
  id?: string;
  /** Tool name (present on the first delta for this index). */
  name?: string;
  /** Incremental fragment of the JSON arguments string. */
  argumentsDelta?: string;
}

/**
 * Parameters for executeLLM and streamLLM.
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

/**
 * One chunk in a server-streaming LLM response from streamLLM.
 * Exactly one of the payload variants is set per chunk.
 * Maps to the proto gibson.daemon.admin.v1.StreamLLMResponse oneof.
 */
export interface DaemonStreamLLMChunk {
  payload:
    | { case: 'textDelta'; value: string }
    | { case: 'toolCallDelta'; value: DaemonToolCallDelta }
    | { case: 'finish'; value: { finishReason: string; usage: DaemonLLMUsage } }
    | { case: 'error'; value: { code: number; message: string; retryable: boolean } }
    | { case: undefined; value?: undefined };
}

// ---------------------------------------------------------------------------
// Proto → friendly type helpers
// ---------------------------------------------------------------------------

function fromProtoProviderRecord(
  p: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ProviderRecord,
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
  };
}

function toProtoDaemonConfigInput(
  input: DaemonProviderConfigInput,
): import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ProviderConfigInput {
  return {
    name: input.name,
    type: input.type,
    defaultModel: input.defaultModel,
    credentials: { ...input.credentials },
    setAsDefault: input.setAsDefault ?? false,
  } as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ProviderConfigInput;
}

function fromProtoLLMUsage(
  u: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMTokenUsage | undefined,
): DaemonLLMUsage {
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    totalTokens: u?.totalTokens ?? 0,
  };
}

function fromProtoLLMToolCall(
  tc: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolCall,
): DaemonLLMToolCall {
  return { id: tc.id, name: tc.name, arguments: tc.arguments };
}

function toLLMMessageContent(
  msg: LLMMessage,
): import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMMessageContent {
  return {
    role: msg.role,
    content: msg.content ?? '',
    toolCalls: (msg.toolCalls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    })) as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolCall[],
    toolResults: (msg.toolResults ?? []).map((tr) => ({
      toolCallId: tr.toolCallId,
      content: tr.content,
      isError: tr.isError,
    })) as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolResult[],
    name: msg.name ?? '',
  } as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMMessageContent;
}

function toLLMToolDef(
  def: DaemonLLMToolDef,
): import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolDef {
  return {
    name: def.name,
    description: def.description,
    parametersJson: def.parametersJson,
  } as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolDef;
}

function toProtoResponseFormat(
  fmt: DaemonResponseFormat,
): import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ResponseFormat {
  return {
    type: fmt.type,
    name: fmt.name ?? '',
    schemaJson: fmt.schemaJson ?? '',
    strict: fmt.strict ?? false,
  } as import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ResponseFormat;
}

function buildExecRequest(
  params: ExecuteLLMParams,
): {
  providerName: string;
  model: string;
  messages: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMMessageContent[];
  tools: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').LLMToolDef[];
  responseFormat?: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').ResponseFormat;
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

function fromProtoStreamChunk(
  chunk: import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb').StreamLLMResponse,
): DaemonStreamLLMChunk {
  const p = chunk.payload;
  switch (p.case) {
    case 'textDelta':
      return { payload: { case: 'textDelta', value: p.value } };
    case 'toolCallDelta':
      return {
        payload: {
          case: 'toolCallDelta',
          value: {
            index: p.value.index,
            id: p.value.id || undefined,
            name: p.value.name || undefined,
            argumentsDelta: p.value.argumentsDelta || undefined,
          },
        },
      };
    case 'finish':
      return {
        payload: {
          case: 'finish',
          value: {
            finishReason: p.value.finishReason,
            usage: fromProtoLLMUsage(p.value.usage),
          },
        },
      };
    case 'error':
      return {
        payload: {
          case: 'error',
          value: {
            code: p.value.code,
            message: p.value.message,
            retryable: p.value.retryable,
          },
        },
      };
    default:
      return { payload: { case: undefined } };
  }
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
 * the daemon — the dashboard process never persists them.
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
 * The config is NOT persisted — the daemon validates and probes the upstream
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

/**
 * Retrieve the tenant's ordered provider fallback chain via the daemon
 * GetFallbackChain RPC. Returns an ordered list of provider names.
 */
export async function daemonGetFallbackChain(
  userId?: string,
  tenantId?: string,
): Promise<string[]> {
  const client = await getAdminClient(userId, tenantId);
  const resp = await client.getFallbackChain({});
  return resp.providerNames ?? [];
}

/**
 * Replace the tenant's provider fallback chain via the daemon SetFallbackChain RPC.
 * All names must refer to existing stored providers.
 * Throws a ConnectError (Code.InvalidArgument) when a name references a
 * non-existent or deleted provider.
 */
export async function daemonSetFallbackChain(
  names: string[],
  userId?: string,
  tenantId?: string,
): Promise<void> {
  const client = await getAdminClient(userId, tenantId);
  await client.setFallbackChain({ providerNames: names });
}

// ---------------------------------------------------------------------------
// Daemon-backed LLM execution functions
// ---------------------------------------------------------------------------

/**
 * Issue a non-streaming LLM completion request via the daemon ExecuteLLM RPC.
 *
 * The daemon resolves the provider name to an encrypted credential record,
 * decrypts it in process memory, and dispatches to the appropriate
 * langchaingo provider. Plaintext credentials never leave daemon memory.
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

/**
 * Issue a server-streaming LLM completion request via the daemon StreamLLM RPC.
 *
 * Returns an async iterable of {@link DaemonStreamLLMChunk} that the caller
 * can consume with `for await (const chunk of stream) {}`. The stream ends
 * naturally when the daemon emits a `finish` chunk, or throws a ConnectError
 * if the gRPC stream closes with an error.
 *
 * The `GibsonLLMAdapter` (task 10) wraps this iterable into a
 * `ReadableStream<LanguageModelV2StreamPart>` for the Vercel AI SDK.
 */
export async function* streamLLM(
  params: ExecuteLLMParams,
  userId?: string,
  tenantId?: string,
): AsyncIterable<DaemonStreamLLMChunk> {
  const client = await getAdminClient(userId, tenantId);
  const grpcStream = client.streamLLM(buildExecRequest(params));
  for await (const chunk of grpcStream) {
    yield fromProtoStreamChunk(chunk);
  }
}
