"use client";

import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import Notifications from "@/components/layout/header/notifications";
import Search from "@/components/layout/header/search";
import UserMenu from "@/components/layout/header/user-menu";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { TenantDisplay } from "@/components/layout/header/tenant-display";
import { PRODUCT_NAME } from "@/src/lib/brand";

function ConnectionStatus() {
  return (
    <div className="flex items-center gap-2" title={`Connected to ${PRODUCT_NAME}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-highlight opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-highlight"></span>
      </span>
      <span className="text-xs text-muted-foreground hidden sm:inline">Connected</span>
    </div>
  );
}

interface SiteHeaderProps {
  /**
   * Tenant switcher slot. The auth layout (a Server Component) renders the
   * `<TenantSwitcher />` Server Component into this slot so the switcher
   * can read memberships + the active-tenant cookie on the server without
   * forcing this header (which uses `useSidebar`) to become a Server
   * Component itself.
   */
  tenantSwitcher?: ReactNode;

  /**
   * Quota widget slot. The auth layout renders <QuotaWidget /> into this
   * slot with the active tenant's plan limits resolved server-side. Spec
   * plans-and-quotas-simplification R9.B.3.
   */
  quotaWidget?: ReactNode;
}

export function SiteHeader({ tenantSwitcher, quotaWidget }: SiteHeaderProps = {}) {
  const { toggleSidebar, open } = useSidebar();

  return (
    <header className="bg-background/40 sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) md:rounded-tl-xl md:rounded-tr-xl">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
        <Button onClick={toggleSidebar} size="icon" variant="ghost">
          {open ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <ConnectionStatus />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <Search />

        <div className="ml-auto flex items-center gap-2">
          {quotaWidget ? (
            <>
              {quotaWidget}
              <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
            </>
          ) : null}
          <TenantDisplay />
          {tenantSwitcher}
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          <Notifications />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
