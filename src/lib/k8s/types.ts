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
  apiVersion: 'gibson.zero-day.ai/v1alpha1';
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

/**
 * Billing subscription status mirroring the Go `BillingSubscriptionStatus`
 * struct in `tenant-operator/api/v1alpha1/tenant_types.go`.
 *
 * Written by the Stripe webhook handlers and the billing reconciler.
 * Absent on Tenant CRs that have not yet entered a billing flow.
 */
export interface BillingStatus {
  /** Stripe subscription ID (sub_...). */
  subscriptionId?: string;
  /** Stripe customer ID (cus_...). */
  customerId?: string;
  /** Stripe price ID currently active on the subscription. */
  priceId?: string;
  /**
   * Subscription lifecycle state mirroring Stripe's status field.
   * Values: trialing | active | past_due | cancelled | incomplete | incomplete_expired
   */
  status?: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'incomplete' | 'incomplete_expired';
  /** ISO 8601 UTC timestamp when the trial period ends. */
  trialEnd?: string;
  /**
   * True when `customer.subscription.trial_will_end` fires (3 days before
   * trialEnd). Reset to false when the first invoice is paid successfully.
   */
  trialEndsSoon?: boolean;
  /** ISO 8601 UTC timestamp for the end of the current billing period. */
  currentPeriodEnd?: string;
  /**
   * ISO 8601 UTC timestamp when the subscription first entered past_due state.
   * Null/absent when not in past_due. Preserved on subsequent retries to
   * track the original failure date for the 7-day enforcement window.
   */
  pastDueSince?: string;
  /** Stripe event ID of the last webhook event that mutated this status. */
  lastWebhookEventId?: string;
  /** ISO 8601 UTC timestamp of the last status update. */
  lastUpdated?: string;
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
  /**
   * Stripe billing subscription state. Written by webhook handlers and the
   * billing reconciler. Absent on tenants with no billing history.
   */
  billing?: BillingStatus;
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
  /**
   * Email of the user who issued the invitation. Server-only — set from
   * the calling user's session in the dashboard server action. Empty
   * string means "system-issued"; the controller renders that as
   * "a Gibson admin" in the outgoing invitation email.
   */
  invitedByEmail?: string;
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
