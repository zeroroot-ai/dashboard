import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { SiteHeader } from "@/components/layout/header";
import { TenantHydrator } from "@/components/layout/tenant-hydrator";
import { TenantSwitcher } from "@/components/gibson/shared/TenantSwitcher";
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
    redirect('/login');
  }

  // Email-verification gate: redirect unverified users to /verify-email before
  // any protected page is rendered. Placed AFTER the session guard (no session
  // → /login) and BEFORE the no-workspace guard so the verification prompt is
  // always the first thing an unverified signed-in user sees.
  //
  // Better Auth's `requireEmailVerification: true` blocks sign-in for users
  // who never verified, but the initial signup session is allowed through so
  // the user can reach this page. This gate closes that window.
  if (session.user.emailVerified === false) {
    const emailParam = session.user.email
      ? `?email=${encodeURIComponent(session.user.email)}`
      : "";
    redirect(`/verify-email${emailParam}`);
  }

  // Zero memberships → onboarding (replaces the old /dashboard/no-workspace
  // redirect); middleware handles this earlier in the request lifecycle, but
  // keeping the gate here protects against direct rendering paths.
  if (!session.user?.tenantId && (!session.user?.tenants || session.user.tenants.length === 0)) {
    redirect('/onboarding');
  }

  const tenantId = session?.user?.tenantId;
  const tenant = tenantId ? await resolveTenant(tenantId, undefined) : null;
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
          <SiteHeader tenantSwitcher={<TenantSwitcher />} />
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
