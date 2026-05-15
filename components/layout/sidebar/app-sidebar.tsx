"use client";

import * as React from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIsTablet } from "@/hooks/use-mobile";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/layout/sidebar/nav-main";
import { NavUser } from "@/components/layout/sidebar/nav-user";
import { TenantSwitcher } from "@/components/layout/sidebar/tenant-switcher";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/src/hooks/useTenant";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  const isTablet = useIsTablet();
  const { currentTenant, isLoading: tenantLoading } = useTenant();

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname]);

  useEffect(() => {
    setOpen(!isTablet);
  }, [isTablet]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="hover:text-foreground h-10 cursor-default group-data-[collapsible=icon]:px-0!"
              tooltip={currentTenant?.displayName ?? "No workspace"}>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md group-data-[collapsible=icon]:size-8">
                <span
                  aria-hidden="true"
                  className="font-display text-2xl font-bold leading-none text-highlight text-zd-glow group-data-[collapsible=icon]:text-3xl"
                >
                  Z
                </span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="font-display text-foreground truncate font-semibold">Zero Day AI</span>
                <span className="text-muted-foreground truncate text-xs">
                  {tenantLoading ? <Skeleton className="h-3 w-20" /> : (currentTenant?.displayName ?? "No workspace")}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <TenantSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full">
          <NavMain />
        </ScrollArea>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
