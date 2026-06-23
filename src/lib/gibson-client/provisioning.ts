import 'server-only';

import { serviceClient } from './transport';
import { TenantProvisioningService } from '@/src/gen/gibson/tenant/v1/provisioning_pb';

/**
 * Typed client for the daemon's tenant-provisioning read side
 * (gibson.tenant.v1.TenantProvisioningService).
 *
 * This replaces the dashboard's direct Kubernetes reads of the Tenant CR
 * (the deleted `src/lib/k8s` surface, dashboard#813). The tenant-operator
 * reports the Tenant CR status into the daemon (ReportTenantStatus); the
 * daemon serves it back here so the web tier holds zero cluster credentials.
 *
 * Both RPCs are unauthenticated (pre-membership signup polling / the
 * Stripe-webhook path) and reached over the SAME `serviceClient(Service, '')`
 * service-acting transport as SignupService — Envoy gates the daemon to the
 * dashboard workload (the documented non-validated tenant boundary,
 * dashboard#815).
 */

/** Per-store provisioning state ("", "provisioning", "ready", "failed"). */
export interface TenantStoreStates {
  postgres: string;
  redis: string;
  neo4j: string;
}

/** Operator-reported provisioning status for a tenant slug. */
export interface TenantProvisioningStatus {
  /** false when no provisioning record exists for the slug (slug available / not provisioned). */
  found: boolean;
  /** Tenant CR status.phase (Pending/Provisioning/Ready/Failed/...); "" until first reported. */
  phase: string;
  /** Mirrors status.dataPlane.ready — the signal onboarding polls. */
  dataPlaneReady: boolean;
  /** Per-store states for the onboarding-progress UI. */
  stores: TenantStoreStates;
  /** Per-tenant Zitadel org login slug (status.zitadelOrgSlug). */
  zitadelOrgSlug: string;
  /** Stripe customer id (status.billing.customerId) for the billing-portal link. */
  stripeCustomerId: string;
  /** Billing-active state last recorded via SetTenantBillingActive. */
  billingActive: boolean;
}

/**
 * Reads the operator-reported provisioning status for a tenant slug, replacing
 * the dashboard's `getTenant()` Kubernetes read. `found: false` (rather than a
 * thrown NOT_FOUND) doubles as a slug-availability / not-yet-provisioned check.
 */
export async function getTenantProvisioningStatus(
  tenantId: string,
): Promise<TenantProvisioningStatus> {
  const resp = await serviceClient(TenantProvisioningService, '').getTenantProvisioningStatus({
    tenantId,
  });
  return {
    found: resp.found,
    phase: resp.phase,
    dataPlaneReady: resp.dataPlaneReady,
    stores: {
      postgres: resp.stores?.postgres ?? '',
      redis: resp.stores?.redis ?? '',
      neo4j: resp.stores?.neo4j ?? '',
    },
    zitadelOrgSlug: resp.zitadelOrgSlug,
    stripeCustomerId: resp.stripeCustomerId,
    billingActive: resp.billingActive,
  };
}

/**
 * Records the tenant's billing-active state, replacing the dashboard billing
 * webhook's `patchTenant()` of the billing-active CR annotation. The daemon
 * persists the flag; the tenant-operator reads it back on its next reconcile
 * and stamps the CR annotation the saga waits on.
 */
export async function setTenantBillingActive(
  tenantId: string,
  active: boolean,
): Promise<void> {
  await serviceClient(TenantProvisioningService, '').setTenantBillingActive({
    tenantId,
    active,
  });
}
