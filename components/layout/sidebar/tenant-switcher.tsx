"use client";

/**
 * TenantSwitcher
 *
 * Renders the active workspace in the sidebar header.
 *
 * Single-tenant users: static label, no interactive chrome.
 * Multi-tenant users: DropdownMenu listing all tenants from the Auth.js
 * session (`gibson:tenants` OIDC claim).  Selecting an item calls
 * `switchTenantAction` (Server Action) which:
 *   1. Validates the slug against the session's tenant list.
 *   2. TODO(post-deploy): sets Zitadel user metadata + triggers token refresh.
 * On success `router.refresh()` is called to pick up the updated JWT cookie.
 * On failure an error toast is shown and the picker remains open.
 *
 * Tenant identity lives ONLY in the OIDC token — no cookie writes, no
 * localStorage, no Zustand store.
 */

import * as React from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { switchTenantAction } from "@/app/actions/tenant/switch";
import { useSession } from "@/src/lib/session-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTenantName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantSwitcher() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { data: session } = useSession();

  // Auth.js session carries `tenant` (active) and `tenants` (all) from the
  // `gibson:tenant` / `gibson:tenants` OIDC claims (auth.ts + Zitadel Action).
  const activeTenant: string | null = session?.user?.tenant ?? null;
  const allTenants: string[] =
    session?.user?.tenants && session.user.tenants.length > 0
      ? session.user.tenants
      : activeTenant
        ? [activeTenant]
        : [];

  const activeLabel = activeTenant
    ? formatTenantName(activeTenant)
    : "No workspace";

  // useTransition gives us a non-blocking pending indicator that integrates
  // with concurrent mode; the dropdown stays responsive while the Server
  // Action round-trip is in flight.
  const [isPending, startTransition] = useTransition();
  // Track which slug is being switched to so we can show per-item loading.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  // Single-tenant or no-tenant: static display only.
  if (allTenants.length <= 1) {
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

  // Multi-tenant: dropdown switcher backed by Server Action.
  function handleSelect(slug: string) {
    if (slug === activeTenant || isPending) return;
    setSwitchingTo(slug);
    startTransition(async () => {
      try {
        const result = await switchTenantAction(slug);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // Token has been refreshed server-side; re-render to pick up the new
        // JWT cookie (new gibson:tenant claim).
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to switch workspace",
        );
      } finally {
        setSwitchingTo(null);
      }
    });
  }

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
            {allTenants.sort().map((slug) => {
              const isActive = slug === activeTenant;
              const isSwitching = slug === switchingTo;
              return (
                <DropdownMenuItem
                  key={slug}
                  onClick={() => handleSelect(slug)}
                  disabled={isPending}
                  aria-checked={isActive}
                  aria-busy={isSwitching}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate">
                    {isSwitching ? "Switching…" : formatTenantName(slug)}
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
