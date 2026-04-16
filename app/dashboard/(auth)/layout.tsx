import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { SiteHeader } from "@/components/layout/header";
import { TenantHydrator } from "@/components/layout/tenant-hydrator";
import { getServerSession } from "@/src/lib/auth";
import { resolveTenant } from "@/src/lib/resolve-tenant";

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
    redirect('/dashboard/login/v2');
  }

  if (!session.user?.tenantId && (!session.user?.tenants || session.user.tenants.length === 0)) {
    redirect('/signup?error=no-org');
  }

  const tenantId = session?.user?.tenantId;
  const tenant = tenantId ? await resolveTenant(tenantId, session?.accessToken) : null;
  const tenants = tenant ? [tenant] : [];

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
      <TenantHydrator initialTenant={tenant} initialTenants={tenants}>
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
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
