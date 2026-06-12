/**
 * Tenant Audit Logging System
 * Track all tenant management actions for security and compliance
 */

// ============================================================================
// Types
// ============================================================================

export type AuditAction =
  | 'tenant.switch'
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.deleted'
  | 'tenant.secrets_namespace_created'
  | 'member.added'
  | 'member.removed'
  | 'member.role_changed'
  | 'settings.updated'
  // Secret lifecycle events (Spec 4 R5)
  | 'secret.create'
  | 'secret.read'
  | 'secret.update'
  | 'secret.delete'
  | 'secret.bind'
  | 'secret.revoke_access'
  | 'secret.config_set'
  // Plugin lifecycle events (Spec 4 R5)
  | 'plugin.register'
  | 'plugin.invoke'
  | 'plugin.heartbeat'
  | 'plugin.unreachable'
  // Authorization events (Spec 4 R5)
  | 'authz.deny';

export type AuditResult = 'success' | 'failure';

export interface AuditLogEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp of the action */
  timestamp: Date;
  /** Action type */
  action: AuditAction;
  /** User who performed the action */
  actorId: string;
  /** Actor's email (for display) */
  actorEmail?: string;
  /** Tenant context */
  tenantId: string;
  /** Tenant name (for display) */
  tenantName?: string;
  /** Action result */
  result: AuditResult;
  /** Action-specific details */
  details: Record<string, unknown>;
  /** Request metadata */
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  };
  /** Error message if result is failure */
  errorMessage?: string;
  // ---------------------------------------------------------------------------
  // Extended fields for secret/plugin/authz drill-down (Spec 4 R5.3)
  // NOTE: credential values are NEVER present in any of these fields.
  // ---------------------------------------------------------------------------
  /** Opaque secret identifier, name/ref only, never the value. */
  secretId?: string;
  /** Capability-grant JWT ID (jti) associated with this event. */
  capabilityGrantId?: string;
  /** Correlation / request ID for cross-service trace linkage. */
  requestId?: string;
  /**
   * Structured error class for `authz.deny` events.
   * e.g. `"fga_no_can_resolve"`, `"no_broker_configured"`.
   */
  errorClass?: string;
  /**
   * Sub-filter field for `authz.deny` events indicating the FGA decision
   * reason. Only populated when `action === "authz.deny"`.
   */
  decisionReason?: string;
}

export interface AuditLogQuery {
  tenantId?: string;
  actorId?: string;
  action?: AuditAction;
  /** Filter by multiple event types simultaneously (OR semantics). */
  actions?: AuditAction[];
  result?: AuditResult;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  // Extended filters (Spec 4 R5)
  secretId?: string;
  capabilityGrantId?: string;
  requestId?: string;
  errorClass?: string;
  /** For `authz.deny` events: filter by specific FGA decision reason. */
  decisionReason?: string;
}

// ============================================================================
// Audit Log Storage
// ============================================================================

// In-memory storage for development (replace with proper backend in production)
const auditLog: AuditLogEntry[] = [];

/**
 * Generates a unique ID for audit entries
 */
function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Gets request metadata from the browser context
 */
function getRequestMetadata(): AuditLogEntry['metadata'] {
  if (typeof window === 'undefined') {
    return {};
  }

  return {
    userAgent: navigator.userAgent,
  };
}

// ============================================================================
// Core Logging Functions
// ============================================================================

/**
 * Creates and stores an audit log entry
 */
async function createAuditEntry(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'metadata'> & {
    metadata?: Partial<AuditLogEntry['metadata']>;
  }
): Promise<AuditLogEntry> {
  const fullEntry: AuditLogEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date(),
    metadata: {
      ...getRequestMetadata(),
      ...entry.metadata,
    },
  };

  // Store locally for development
  auditLog.push(fullEntry);

  // In production, this would send to the backend
  if (process.env.NODE_ENV === 'production') {
    try {
      await fetch('/api/audit-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullEntry),
      });
    } catch (error) {
      console.error('[AuditLog] Failed to persist entry:', error);
    }
  }

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[AuditLog]', fullEntry);
  }

  return fullEntry;
}

// ============================================================================
// Tenant Operations Logging
// ============================================================================

/**
 * Log a tenant switch event
 */
export async function logTenantSwitch(
  actorId: string,
  fromTenantId: string | null,
  toTenantId: string,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'tenant.switch',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId: toTenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      fromTenantId,
      toTenantId,
    },
    errorMessage: options?.errorMessage,
  });
}

/**
 * Log a tenant creation event
 */
export async function logTenantCreated(
  actorId: string,
  tenantId: string,
  tenantData: {
    name: string;
    displayName: string;
    description?: string;
  },
  options?: {
    actorEmail?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'tenant.created',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: tenantData.displayName,
    result: options?.result ?? 'success',
    details: {
      tenantName: tenantData.name,
      displayName: tenantData.displayName,
      description: tenantData.description,
    },
    errorMessage: options?.errorMessage,
  });
}

/**
 * Log a tenant update event
 */
export async function logTenantUpdated(
  actorId: string,
  tenantId: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'tenant.updated',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      changes,
      fieldsModified: Object.keys(changes),
    },
    errorMessage: options?.errorMessage,
  });
}

/**
 * Log a tenant deletion event
 */
export async function logTenantDeleted(
  actorId: string,
  tenantId: string,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    memberCount?: number;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'tenant.deleted',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      memberCount: options?.memberCount,
      deletedAt: new Date().toISOString(),
    },
    errorMessage: options?.errorMessage,
  });
}

// ============================================================================
// Member Operations Logging
// ============================================================================

/**
 * Log a member addition event
 */
export async function logMemberAdded(
  actorId: string,
  tenantId: string,
  addedUserId: string,
  role: string,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    addedUserEmail?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'member.added',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      addedUserId,
      addedUserEmail: options?.addedUserEmail,
      role,
    },
    errorMessage: options?.errorMessage,
  });
}

/**
 * Log a member removal event
 */
export async function logMemberRemoved(
  actorId: string,
  tenantId: string,
  removedUserId: string,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    removedUserEmail?: string;
    previousRole?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'member.removed',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      removedUserId,
      removedUserEmail: options?.removedUserEmail,
      previousRole: options?.previousRole,
    },
    errorMessage: options?.errorMessage,
  });
}

/**
 * Log a member role change event
 */
export async function logMemberRoleChanged(
  actorId: string,
  tenantId: string,
  targetUserId: string,
  fromRole: string,
  toRole: string,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    targetUserEmail?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'member.role_changed',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      targetUserId,
      targetUserEmail: options?.targetUserEmail,
      fromRole,
      toRole,
    },
    errorMessage: options?.errorMessage,
  });
}

// ============================================================================
// Settings Logging
// ============================================================================

/**
 * Log a settings update event
 */
export async function logSettingsUpdated(
  actorId: string,
  tenantId: string,
  section: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  options?: {
    actorEmail?: string;
    tenantName?: string;
    result?: AuditResult;
    errorMessage?: string;
  }
): Promise<AuditLogEntry> {
  return createAuditEntry({
    action: 'settings.updated',
    actorId,
    actorEmail: options?.actorEmail,
    tenantId,
    tenantName: options?.tenantName,
    result: options?.result ?? 'success',
    details: {
      section,
      changes,
      fieldsModified: Object.keys(changes),
    },
    errorMessage: options?.errorMessage,
  });
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Query audit log entries
 */
export async function queryAuditLog(query: AuditLogQuery): Promise<{
  entries: AuditLogEntry[];
  total: number;
  hasMore: boolean;
}> {
  // In production, this would call the backend
  // For now, filter in-memory
  let filtered = [...auditLog];

  if (query.tenantId) {
    filtered = filtered.filter((e) => e.tenantId === query.tenantId);
  }
  if (query.actorId) {
    filtered = filtered.filter((e) => e.actorId === query.actorId);
  }
  if (query.action) {
    filtered = filtered.filter((e) => e.action === query.action);
  }
  // `actions` is an OR-filter across multiple event types; takes precedence
  // over the singular `action` when both are present.
  if (query.actions && query.actions.length > 0) {
    const actionSet = new Set(query.actions);
    filtered = filtered.filter((e) => actionSet.has(e.action));
  }
  if (query.result) {
    filtered = filtered.filter((e) => e.result === query.result);
  }
  if (query.startDate) {
    filtered = filtered.filter((e) => e.timestamp >= query.startDate!);
  }
  if (query.endDate) {
    filtered = filtered.filter((e) => e.timestamp <= query.endDate!);
  }
  // Extended filters (Spec 4 R5)
  if (query.secretId) {
    filtered = filtered.filter((e) => e.secretId === query.secretId);
  }
  if (query.capabilityGrantId) {
    filtered = filtered.filter((e) => e.capabilityGrantId === query.capabilityGrantId);
  }
  if (query.requestId) {
    filtered = filtered.filter((e) => e.requestId === query.requestId);
  }
  if (query.errorClass) {
    filtered = filtered.filter((e) => e.errorClass === query.errorClass);
  }
  if (query.decisionReason) {
    filtered = filtered.filter((e) => e.decisionReason === query.decisionReason);
  }

  // Sort by timestamp descending
  filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const total = filtered.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;

  const entries = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { entries, total, hasMore };
}

/**
 * Get audit log entries for a specific tenant
 */
export async function getTenantAuditLog(
  tenantId: string,
  limit = 50
): Promise<AuditLogEntry[]> {
  const result = await queryAuditLog({ tenantId, limit });
  return result.entries;
}

/**
 * Get recent actions by a specific user
 */
export async function getUserAuditLog(
  actorId: string,
  limit = 50
): Promise<AuditLogEntry[]> {
  const result = await queryAuditLog({ actorId, limit });
  return result.entries;
}

// ============================================================================
// Export Functions (Compliance)
// ============================================================================

/**
 * Export audit log entries as CSV
 */
export function exportAuditLogAsCSV(entries: AuditLogEntry[]): string {
  // Extended headers include the new Spec 4 R5 fields.
  // IMPORTANT: credential values are NEVER present in any audit row -
  // the AuditLogEntry type has no value field by design.
  const headers = [
    'ID',
    'Timestamp',
    'Action',
    'Actor ID',
    'Actor Email',
    'Tenant ID',
    'Tenant Name',
    'Result',
    'Details',
    'IP Address',
    'User Agent',
    'Error Message',
    // Extended fields (Spec 4 R5.3)
    'Secret ID',
    'Capability Grant ID',
    'Request ID',
    'Error Class',
    'Decision Reason',
  ];

  const rows = entries.map((entry) => [
    entry.id,
    entry.timestamp.toISOString(),
    entry.action,
    entry.actorId,
    entry.actorEmail || '',
    entry.tenantId,
    entry.tenantName || '',
    entry.result,
    JSON.stringify(entry.details),
    entry.metadata.ipAddress || '',
    entry.metadata.userAgent || '',
    entry.errorMessage || '',
    // Extended fields, empty string when absent so column count stays constant
    entry.secretId || '',
    entry.capabilityGrantId || '',
    entry.requestId || '',
    entry.errorClass || '',
    entry.decisionReason || '',
  ]);

  return [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
}

/**
 * Export audit log entries as JSON
 */
export function exportAuditLogAsJSON(entries: AuditLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
