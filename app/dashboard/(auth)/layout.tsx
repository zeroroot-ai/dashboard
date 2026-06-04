import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { SiteHeader } from "@/components/layout/header";
import { TenantHydrator } from "@/components/layout/tenant-hydrator";
import { TenantSwitcher } from "@/components/gibson/shared/TenantSwitcher";
import { QuotaWidget } from "@/src/components/quota/quota-widget";
import { getServerSession } from "@/src/lib/auth";
import { readRawActiveTenant } from "@/src/lib/auth/active-tenant";
import { resolveTenant } from "@/src/lib/resolve-tenant";
import { getTenantQuotaAction } from "@/app/actions/read/getTenantQuota";
import { logger } from "@/src/lib/logger";
import type { Tenant } from "@/src/types/tenant";

export default async function AuthLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultOpen =
    cookieStore.get("sidebar_state")?.value === "true" ||
    cookieStore.get("sidebar_state") === undefined;

  const session = await getServerSession();

  if (!session) {
    redirect('/login');
  }

  // Email-verification gate: redirect unverified users to /verify-email before
  // any protected page is rendered.
  if (session.user.emailVerified === false) {
    const emailParam = session.user.email
      ? `?email=${encodeURIComponent(session.user.email)}`
      : "";
    redirect(`/verify-email${emailParam}`);
  }

  // Zero memberships → onboarding. Middleware handles this earlier in the
  // request lifecycle, but keeping the gate here protects against direct
  // rendering paths.
  if (!session.user?.tenants || session.user.tenants.length === 0) {
    redirect('/onboarding');
  }

  // Resolve every member tenant's CRD so the sidebar / header can show
  // displayNames and the switcher can list the full set. resolveTenant
  // returns null on lookup failure; drop nulls so a single broken CR
  // doesn't break the whole chrome render.
  const memberSlugs = session.user.tenants ?? [];
  const resolved = await Promise.all(
    memberSlugs.map((slug) => resolveTenant(slug, undefined)),
  );
  const availableTenants: Tenant[] = resolved.filter(
    (t): t is Tenant => t !== null,
  );

  // Read the active tenant from the HMAC-signed cookie (read-only; no auto-pick).
  // Pages that need the active tenant to be required call requireActiveTenant()
  // themselves. The layout only needs it for CRD resolution (quota widget, etc.).
  const rawActiveTenant = await readRawActiveTenant();
  const activeTenantId: string | null =
    rawActiveTenant.status === 'present' && session.user.tenants.includes(rawActiveTenant.tenantId!)
      ? rawActiveTenant.tenantId!
      : null;

  const currentTenant: Tenant | null = activeTenantId
    ? (availableTenants.find((t) => t.id === activeTenantId) ?? null)
    : null;

  // Resolve plan limits for the in-app quota widget from the daemon's
  // GetTenantQuota RPC (tenant_quotas Postgres row) — NOT the Tenant CR's
  // spec.tier. Per ADR-0044 the dashboard's only K8s access is tenant
  // provisioning; quota limits are a daemon read. Failures degrade silently
  // to zero (widget hides). Spec plans-and-quotas-simplification R9.B.3.
  let missionsLimit = 0;
  let agentsLimit = 0;
  if (activeTenantId) {
    try {
      const quota = await getTenantQuotaAction();
      if (quota.ok) {
        missionsLimit = quota.data.concurrentMissions;
        agentsLimit = quota.data.concurrentAgents;
      }
    } catch (err) {
      logger.warn(
        { err: String(err), tenantId: activeTenantId },
        "[auth-layout] could not resolve plan limits for quota widget",
      );
    }
  }

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 14)",
          "--content-padding": "calc(var(--spacing) * 4)",
          "--content-margin": "calc(var(--spacing) * 1.5)",
          "--content-full-height":
            "calc(100vh - var(--header-height) - (var(--content-padding) * 2) - (var(--content-margin) * 2))"
        } as React.CSSProperties
      }>
      <TenantHydrator
        currentTenant={currentTenant}
        availableTenants={availableTenants}
        crossTenant={session.user.crossTenant ?? false}
        rolesByTenant={session.user.rolesByTenant ?? {}}
        groups={session.user.groups ?? []}
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader
            tenantSwitcher={<TenantSwitcher />}
            quotaWidget={
              currentTenant ? (
                <QuotaWidget
                  missionsLimit={missionsLimit}
                  agentsLimit={agentsLimit}
                />
              ) : null
            }
          />
          <div className="bg-muted/40 flex flex-1 flex-col">
            <div className="@container/main p-(--content-padding) xl:group-data-[theme-content-layout=centered]/layout:container xl:group-data-[theme-content-layout=centered]/layout:mx-auto">
              {children}
            </div>
          </div>
        </SidebarInset>
      </TenantHydrator>
    </SidebarProvider>
  );
}
