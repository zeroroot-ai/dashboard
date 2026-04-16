/**
 * Tenant Type Definitions
 * Minimal surface preserved after CRD migration. Most tenant CRUD has moved
 * to the CRD actions in `app/actions/crd/`. This module only keeps the shapes
 * that client-side components still reference for display/session handling.
 */

/**
 * Core tenant entity for session/display purposes.
 */
export interface Tenant {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  color?: string;
  icon?: string;
  settings?: TenantSettings;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  memberCount?: number;
}

export interface TenantSettings {
  mission?: {
    defaultLLMSlot?: string;
    maxConcurrentMissions?: number;
    maxMissionDuration?: number;
  };
  limits?: {
    apiRateLimit?: number;
    llmTokenLimit?: number;
    storageLimit?: number;
  };
  notifications?: {
    email?: boolean;
    webhook?: string;
    notifyOnFindings?: boolean;
    notifyOnMissionComplete?: boolean;
  };
  integrations?: {
    gitlab?: { enabled: boolean; url?: string };
    jira?: { enabled: boolean; url?: string; project?: string };
  };
}

export type TenantRole = 'viewer' | 'operator' | 'admin';

export interface TenantSwitchRequest {
  tenantId: string;
}

export interface TenantSwitchResponse {
  success: boolean;
  tenant: Tenant;
  sessionUpdated: boolean;
  message?: string;
}
