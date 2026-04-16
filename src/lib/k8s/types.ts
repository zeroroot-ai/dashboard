/**
 * TypeScript mirrors of the Gibson CRDs defined in
 * core/tenant-operator/api/v1alpha1/. Hand-maintained; kept in sync with
 * the Go structs via CI drift check.
 */

export interface K8sCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export interface K8sObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  finalizers?: string[];
}

export interface K8sResource<Spec, Status> {
  apiVersion: 'gibson.gibson.io/v1alpha1';
  kind: string;
  metadata: K8sObjectMeta;
  spec: Spec;
  status?: Status;
}

export interface WatchEvent<T> {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';
  object: T;
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export type TenantPhase =
  | 'Pending'
  | 'Provisioning'
  | 'Ready'
  | 'Failed'
  | 'Terminating'
  | 'Terminated';

export type TenantTier = 'free' | 'pro' | 'enterprise';

export interface TenantSpec {
  displayName: string;
  owner: string;
  tier: TenantTier;
  stripeCustomerId?: string;
}

export interface TenantStatus {
  phase?: TenantPhase;
  conditions?: K8sCondition[];
  namespace?: string;
  betterAuthOrgId?: string;
  langfuseProjectId?: string;
  observedGeneration?: number;
  tierObserved?: TenantTier;
}

export interface Tenant extends K8sResource<TenantSpec, TenantStatus> {
  kind: 'Tenant';
}

// ---------------------------------------------------------------------------
// TenantMember
// ---------------------------------------------------------------------------

export type MemberRole = 'admin' | 'member' | 'viewer';

export type TenantMemberPhase =
  | 'Pending'
  | 'Invited'
  | 'Accepting'
  | 'Active'
  | 'Expired'
  | 'Revoked';

export interface TenantMemberSpec {
  email: string;
  role: MemberRole;
  tenantRef: { name: string };
  acceptedByUserId?: string;
  resendRequestedAt?: string;
}

export interface TenantMemberStatus {
  phase?: TenantMemberPhase;
  conditions?: K8sCondition[];
  invitationTokenHash?: string;
  invitationExpiresAt?: string;
  invitationSecretRef?: string;
  userId?: string;
  lastResendAt?: string;
  observedGeneration?: number;
}

export interface TenantMember extends K8sResource<TenantMemberSpec, TenantMemberStatus> {
  kind: 'TenantMember';
}

// ---------------------------------------------------------------------------
// AgentEnrollment
// ---------------------------------------------------------------------------

export type AgentMode = 'autonomous' | 'supervised';
export type ComponentKind = 'agent' | 'tool' | 'plugin';

export type AgentEnrollmentPhase =
  | 'Pending'
  | 'BootstrapReady'
  | 'Enrolling'
  | 'Active'
  | 'Degraded'
  | 'Revoked'
  | 'Failed'
  | 'Terminated';

export interface ComponentRef {
  kind: ComponentKind;
  name: string;
}

export interface AgentEnrollmentSpec {
  agentName: string;
  mode: AgentMode;
  componentGrants?: ComponentRef[];
  maxRuntime?: string;
  notes?: string;
}

export interface AgentEnrollmentStatus {
  phase?: AgentEnrollmentPhase;
  conditions?: K8sCondition[];
  hostId?: string;
  bootstrapSecretRef?: string;
  bootstrapExpiresAt?: string;
  lastHeartbeat?: string;
  grantsAppliedCount?: number;
  observedGeneration?: number;
}

export interface AgentEnrollment
  extends K8sResource<AgentEnrollmentSpec, AgentEnrollmentStatus> {
  kind: 'AgentEnrollment';
}

// ---------------------------------------------------------------------------
// ComponentGrant
// ---------------------------------------------------------------------------

export type ComponentGrantPhase = 'Pending' | 'Active' | 'Revoked' | 'Failed';
export type GrantScope = 'tenant' | 'per-user';

export interface ComponentGrantSpec {
  componentRef: ComponentRef;
  scope?: GrantScope;
  restrictions?: Record<string, string>;
}

export interface ComponentGrantStatus {
  phase?: ComponentGrantPhase;
  conditions?: K8sCondition[];
  fgaTuplesWritten?: number;
  observedGeneration?: number;
}

export interface ComponentGrant
  extends K8sResource<ComponentGrantSpec, ComponentGrantStatus> {
  kind: 'ComponentGrant';
}

// ---------------------------------------------------------------------------
// CRD kind registry
// ---------------------------------------------------------------------------

export type GibsonCRD = Tenant | TenantMember | AgentEnrollment | ComponentGrant;

export const CRDPlurals = {
  Tenant: 'tenants',
  TenantMember: 'tenantmembers',
  AgentEnrollment: 'agentenrollments',
  ComponentGrant: 'componentgrants',
} as const;

export type CRDKind = keyof typeof CRDPlurals;
