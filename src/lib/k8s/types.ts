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
  ownerReferences?: import('./owner-ref').K8sOwnerReference[];
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

/**
 * Canonical Gibson plan IDs. Single source of truth — these match the
 * operator's `plans.PlanID` Go enum (tenant-operator/plans/registry.go).
 *
 * Legacy values `free`/`pro`/`enterprise` are NOT accepted; the
 * entitlements reconciler rejects them as deprecated.
 */
export type TenantTier =
  | 'solo'
  | 'squad'
  | 'org'
  | 'platform'
  | 'enterprise-cloud'
  | 'enterprise-onprem'
  | 'public-sector';

export interface TenantSpec {
  displayName: string;
  owner: string;
  tier: TenantTier;
  stripeCustomerId?: string;
}

/** Provisioning state for a single data-plane store (Task 21). */
export type DataPlaneStoreState = 'provisioning' | 'ready' | 'failed';

/** Per-store status entry written by the tenant-operator saga (Task 21). */
export interface DataPlaneStoreStatus {
  state: DataPlaneStoreState;
  reason?: string;
  lastUpdated?: string;
}

/**
 * Data-plane provisioning status written by the tenant-operator.
 * Added in Task 21; absent on legacy Tenant CRs (use optional chaining).
 */
export interface TenantDataPlaneStatus {
  stores?: {
    postgres?: DataPlaneStoreStatus;
    redis?: DataPlaneStoreStatus;
    neo4j?: DataPlaneStoreStatus;
  };
}

export interface TenantStatus {
  phase?: TenantPhase;
  conditions?: K8sCondition[];
  namespace?: string;
  /** Zitadel organization ID written by the EnsureZitadelOrg saga step. */
  zitadelOrgID?: string;
  /** Zitadel primary-domain slug, typically equal to Tenant.metadata.name. */
  zitadelOrgSlug?: string;
  langfuseProjectId?: string;
  observedGeneration?: number;
  tierObserved?: TenantTier;
  /**
   * Data-plane store provisioning status. Written by the tenant-operator at
   * each saga step. Absent on pre-Task-21 Tenant CRs.
   */
  dataPlane?: TenantDataPlaneStatus;
}

export interface Tenant extends K8sResource<TenantSpec, TenantStatus> {
  kind: 'Tenant';
}

// ---------------------------------------------------------------------------
// TenantMember
// ---------------------------------------------------------------------------

// `owner` is the self-signup creator role; defined in the operator's
// tenantmember_controller.go (MemberRoleOwner constant).
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

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
