// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * TenantSwitcher (sidebar)
 *
 * Renders the active workspace in the sidebar header.
 *
 * A person has exactly one tenant, resolved server-side from their
 * identity (ADR-0093 decision 4), so this always renders the static-label
 * branch (`availableTenants.length <= 1` is now always true) — there is no
 * switching. The dropdown branch below is retained only because
 * `TenantContextProvider` still models a list for other historical
 * consumers; it never renders more than one entry.
 */

import * as React from "react";
import { useState, useTransition } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTenantContext } from "@/src/lib/tenant-context";

export function TenantSwitcher() {
  const { isMobile } = useSidebar();
  const { currentTenant, availableTenants, switchTenant } = useTenantContext();

  const activeLabel = currentTenant?.displayName ?? "No workspace";

  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  // Single-tenant or no-tenant: static display only.
  if (availableTenants.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="cursor-default hover:bg-transparent group-data-[collapsible=icon]:px-0!"
            tooltip={activeLabel}
          >
            <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium text-foreground">
                {activeLabel}
              </span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  function handleSelect(tenantId: string) {
    if (tenantId === currentTenant?.id || isPending) return;
    setSwitchingTo(tenantId);
    startTransition(async () => {
      try {
        await switchTenant(tenantId);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to switch workspace",
        );
      } finally {
        setSwitchingTo(null);
      }
    });
  }

  // Stable order: alphabetical by displayName.
  const sorted = [...availableTenants].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:px-0!"
              tooltip={activeLabel}
              aria-label={`Switch workspace. Current: ${activeLabel}`}
              aria-busy={isPending}
            >
              <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium text-foreground">
                  {activeLabel}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  Workspace
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-48 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sorted.map((tenant) => {
              const isActive = tenant.id === currentTenant?.id;
              const isSwitching = tenant.id === switchingTo;
              return (
                <DropdownMenuItem
                  key={tenant.id}
                  onClick={() => handleSelect(tenant.id)}
                  disabled={isPending}
                  aria-checked={isActive}
                  aria-busy={isSwitching}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate">
                    {isSwitching ? "Switching…" : tenant.displayName}
                  </span>
                  {isActive && !isSwitching && (
                    <CheckIcon
                      className="size-4 shrink-0"
                      aria-label="Active workspace"
                    />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
