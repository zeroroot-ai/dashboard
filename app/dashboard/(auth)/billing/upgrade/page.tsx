/**
 * /billing/upgrade — server-rendered redirect to a Stripe Customer Portal
 * upgrade-flow session. Spec plans-and-quotas-simplification R9.B
 * (in-app upgrade routing).
 *
 * Reads ?target=enterprise (or any future Stripe-priced plan id) and
 * creates a portal session for the active tenant's Stripe customer.
 * Stripe's portal handles the actual upgrade UX; this route just opens it.
 *
 * If the tenant has no Stripe customer (free / on-prem), redirects to the
 * settings/billing page where they can complete signup or contact sales.
 */

import { redirect } from "next/navigation";

import { createPortalSession } from "@/src/lib/billing/stripe";
import { getTenant } from "@/src/lib/k8s/tenants";
import { readRawActiveTenant } from "@/src/lib/auth/active-tenant";
import { logger } from "@/src/lib/logger";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ target?: string }>;

export default async function BillingUpgradePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const target = params.target ?? "enterprise";

  const activeTenant = await readRawActiveTenant();
  const tenantSlug = activeTenant?.tenantId;
  if (!tenantSlug) {
    redirect("/login");
  }

  let tenant: Awaited<ReturnType<typeof getTenant>> | null = null;
  try {
    tenant = await getTenant(tenantSlug);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug, target },
      "[billing/upgrade] failed to load tenant",
    );
    redirect("/dashboard/pages/settings/billing?error=billing_unavailable");
  }

  const customerId = tenant?.spec?.stripeCustomerId;
  if (!customerId) {
    // No Stripe customer yet — bounce to settings page where the user can
    // start a fresh checkout / see their current plan.
    redirect("/dashboard/pages/settings/billing");
  }

  const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
  const returnUrl = `${publicUrl}/dashboard/pages/settings/billing`;
  const idempotencyKey = `tenant:${tenantSlug}:upgrade:${target}:${Math.floor(Date.now() / 10000)}`;

  try {
    const session = await createPortalSession({
      customerId,
      returnUrl,
      idempotencyKey,
    });
    redirect(session.url);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug, target },
      "[billing/upgrade] portal session creation failed",
    );
    redirect("/dashboard/pages/settings/billing?error=portal_failed");
  }
}
