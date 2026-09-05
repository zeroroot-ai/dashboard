import 'server-only';

import { serviceClient, userClient } from './transport';
import { TenantProvisioningService } from '@/src/gen/gibson/tenant/v1/provisioning_pb';
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';
import { AdminTenantService } from '@/src/gen/gibson/tenant/v1/admin_tenant_pb';

/**
 * Typed client for the daemon's tenant-provisioning read side
 * (gibson.tenant.v1.TenantProvisioningService), plus the two rule-mode
 * billing-identifier RPCs that replaced its redacted fields (gibson#1339/#1361).
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
 * unredaction branch can never be taken by ANY dashboard caller. The three
 * fields it withholds — `zitadel_org_slug`, `stripe_customer_id`,
 * `billing_active` — are therefore deliberately ABSENT from
 * {@link TenantProvisioningStatus}: reading them is a compile error rather
 * than a silent `''`/`false` (dashboard#1016).
 *
 * `getTenantBilling` and `adminGetTenantBilling` are DIFFERENT: they are
 * rule-mode RPCs that require an authenticated caller, so they go through
 * `userClient` (see gibson#1339 — an unauthenticated-mode RPC never has its
 * tenant resolved by ext-authz, which is exactly why `stripe_customer_id` /
 * `billing_active` moved off `GetTenantProvisioningStatus` onto these).
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
 * DELIBERATELY does NOT carry `zitadelOrgSlug`, `stripeCustomerId` or
 * `billingActive`. The daemon withholds all three from every caller of the
 * unauthenticated `GetTenantProvisioningStatus` RPC (gibson#1230/#1339), so
 * mapping them here would hand every future reader a silent `''`/`false` —
 * which is exactly how the billing portal, admin trial-extension and the
 * signup readiness poll all broke at once (dashboard#1016). Omitting them
 * turns that mistake into a compile error. Read {@link getTenantBilling}
 * (own tenant) or {@link adminGetTenantBilling} (cross-tenant) instead.
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
 * The wire response still carries `zitadelOrgSlug` / `stripeCustomerId` /
 * `billingActive` fields for other (authenticated) callers of the same message
 * type; this mapper drops them unconditionally rather than forwarding whatever
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

// `TenantProvisioningService.SetTenantBillingActive` has NO dashboard wrapper on
// purpose (dashboard#1016). The helper that used to sit here was unexported and
// uncalled since the day it landed, and it can no longer work: the daemon now
// requires a fresh HMAC assertion on that RPC (`x-gibson-billing-signature` /
// `x-gibson-billing-issued-at`, signed with `GIBSON_BILLING_WEBHOOK_SECRET`),
// a secret the dashboard does not hold and must not hold. The dashboard also
// serves no Stripe webhook route, so it is not the Stripe→daemon hop. Ownership
// of the signed call belongs to whichever component owns the Stripe webhook;
// do not reintroduce a wrapper here without that decision.

/** Billing identifiers for a tenant, served by the rule-mode `GetTenantBilling`
 * / `AdminGetTenantBilling` RPCs (gibson#1339/#1361) rather than the
 * unauthenticated `TenantProvisioningService.GetTenantProvisioningStatus`,
 * which can never resolve a caller's tenant to unredact these fields.
 * Not exported: callers rely on the structural return type of
 * {@link getTenantBilling} / {@link adminGetTenantBilling} rather than
 * importing this name (knip flags an exported-but-unimported type). */
interface TenantBillingStatus {
  /** false when the tenant has no provisioning record yet. */
  found: boolean;
  /** Stripe customer id, used to open the Stripe customer portal. */
  stripeCustomerId: string;
  /** Billing-active state last recorded via SetTenantBillingActive. */
  billingActive: boolean;
  /** Per-tenant Zitadel org login slug. */
  zitadelOrgSlug: string;
}

/**
 * Reads the CALLING tenant's own billing identifiers via the rule-mode
 * `TenantService.GetTenantBilling` RPC (gibson#1339/#1361).
 *
 * Unlike `getTenantProvisioningStatus`, this RPC is NOT unauthenticated:
 * ext-authz resolves the caller's tenant from their identity
 * (`tenant_from_identity`) BEFORE the handler runs, so FGA enforces
 * same-tenant access at the gateway rather than relying on an in-handler
 * redaction an unauthenticated-mode RPC could never satisfy (gibson#1339).
 * Call via `userClient` so the daemon sees the signed-in user's own tenant —
 * the request carries no `tenant_id`, there is nothing for a caller to spoof.
 */
export async function getTenantBilling(): Promise<TenantBillingStatus> {
  const resp = await userClient(TenantService).getTenantBilling({});
  return {
    found: resp.found,
    stripeCustomerId: resp.stripeCustomerId,
    billingActive: resp.billingActive,
    zitadelOrgSlug: resp.zitadelOrgSlug,
  };
}

/**
 * Reads ANY tenant's billing identifiers via the rule-mode
 * `AdminTenantService.AdminGetTenantBilling` RPC (gibson#1339/#1361) — a
 * genuine cross-tenant read. Gated `platform_operator` on `system_tenant` by
 * ext-authz/FGA and by this method's typed authz-registry entry (enforced a
 * second time client-side via `userClient`'s `assertAuthorized`
 * interceptor). Callers MUST additionally hold their own cross-tenant gate
 * (e.g. `isCrossTenant(session)`, see
 * `app/api/admin/billing/trial-extension/route.ts`) before calling this —
 * the daemon gate is defense-in-depth, not a substitute for the route-level
 * check, since `tenantId` here is untrusted caller input.
 */
export async function adminGetTenantBilling(
  tenantId: string,
): Promise<TenantBillingStatus> {
  const resp = await userClient(AdminTenantService).adminGetTenantBilling({
    tenantId,
  });
  return {
    found: resp.found,
    stripeCustomerId: resp.stripeCustomerId,
    billingActive: resp.billingActive,
    zitadelOrgSlug: resp.zitadelOrgSlug,
  };
}
