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
  | 'member.added'
  | 'member.removed'
  | 'member.role_changed'
  | 'settings.updated';

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
}

export interface AuditLogQuery {
  tenantId?: string;
  actorId?: string;
  action?: AuditAction;
  result?: AuditResult;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
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
  if (query.result) {
    filtered = filtered.filter((e) => e.result === query.result);
  }
  if (query.startDate) {
    filtered = filtered.filter((e) => e.timestamp >= query.startDate!);
  }
  if (query.endDate) {
    filtered = filtered.filter((e) => e.timestamp <= query.endDate!);
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
