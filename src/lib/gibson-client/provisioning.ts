// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
 * `getTenantProvisioningStatus` is unauthenticated (pre-membership signup
 * polling) and reached over the SAME `serviceClient(Service, '')`
 * service-acting transport as SignupService — Envoy gates the daemon to the
 * dashboard workload (the documented non-validated tenant boundary,
 * dashboard#815). Because the RPC is proto-annotated `unauthenticated: true`,
 * ext-authz never resolves a tenant for it, so the daemon's same-tenant
 * unredaction branch can never be taken by ANY dashboard caller. The field it
 * withholds, `zitadel_org_slug`, is therefore deliberately ABSENT from
 * {@link TenantProvisioningStatus}: reading it is a compile error rather than
 * a silent `''` (dashboard#1016).
 */

/** Per-store provisioning state ("", "provisioning", "ready", "failed"). */
export interface TenantStoreStates {
  postgres: string;
  redis: string;
  neo4j: string;
}

/**
 * Operator-reported provisioning status for a tenant slug.
 *
 * DELIBERATELY does NOT carry `zitadelOrgSlug`. The daemon withholds it from
 * every caller of the unauthenticated `GetTenantProvisioningStatus` RPC
 * (gibson#1230/#1339), so mapping it here would hand every future reader a
 * silent `''`, which is how the signup readiness poll broke (dashboard#1016).
 * Omitting it turns that mistake into a compile error.
 */
export interface TenantProvisioningStatus {
  /** false when no provisioning record exists for the slug (slug available / not provisioned). */
  found: boolean;
  /** Tenant CR status.phase (Pending/Provisioning/Ready/Failed/...); "" until first reported. */
  phase: string;
  /** Mirrors status.dataPlane.ready — the signal onboarding polls. */
  dataPlaneReady: boolean;
  /** Per-store states for the onboarding-progress UI. */
  stores: TenantStoreStates;
  /** Whether the per-tenant Zitadel org exists, without disclosing its slug. Survives
   * the cross-tenant redaction that blanks zitadel_org_slug (gibson#1230/#1333) — this is
   * the readiness signal the signup poller reads, and the only org-related field
   * this RPC can honestly answer. */
  zitadelOrgReady: boolean;
}

/**
 * Reads the operator-reported provisioning status for a tenant slug, replacing
 * the dashboard's `getTenant()` Kubernetes read. `found: false` (rather than a
 * thrown NOT_FOUND) doubles as a slug-availability / not-yet-provisioned check.
 *
 * The wire response still carries a `zitadelOrgSlug` field for other
 * (authenticated) callers of the same message type; this mapper drops it
 * unconditionally rather than forwarding whatever
 * the daemon happened to send. See {@link TenantProvisioningStatus}.
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
    zitadelOrgReady: resp.zitadelOrgReady,
  };
}
