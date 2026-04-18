"use client";

/**
 * TenantSwitcher
 *
 * Renders the active workspace in the sidebar header.
 *
 * Single-tenant users see a static label — no interactive chrome.
 * Multi-tenant users get a DropdownMenu with all their tenants listed;
 * the active tenant is marked with a checkmark. Selecting an item POSTs
 * to /api/tenant/select and calls router.refresh() on success so the
 * layout re-fetches with the updated activeOrganizationId.
 *
 * Visual vocabulary follows nav-user.tsx — SidebarMenuButton as the
 * trigger, collapsed-icon behaviour via group-data-[collapsible=icon].
 */

import * as React from "react";
import { useState } from "react";
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

type GibsonSessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  tenants?: string[];
  tenantId?: string;
};

/** Read Gibson-extended fields that Better Auth does not type natively. */
function getGibsonFields(session: ReturnType<typeof useSession>["data"]): {
  tenants: string[];
  tenantId: string | null;
} {
  const user = session?.user as GibsonSessionUser | undefined;
  return {
    tenants: user?.tenants ?? [],
    tenantId: user?.tenantId ?? session?.session?.activeOrganizationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantSwitcher() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { data: session } = useSession();
  const { tenants, tenantId } = getGibsonFields(session);

  const [pending, setPending] = useState(false);

  const activeTenant = tenantId ?? tenants[0] ?? null;
  const activeLabel = activeTenant ? formatTenantName(activeTenant) : "No workspace";

  // Single-tenant or no-tenant: static display only.
  if (tenants.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="cursor-default hover:bg-transparent group-data-[collapsible=icon]:px-0!"
            tooltip={activeLabel}
          >
            <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium text-foreground">{activeLabel}</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // Multi-tenant: dropdown switcher.
  async function handleSelect(slug: string) {
    if (slug === activeTenant || pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/tenant/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: slug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to switch workspace",
      );
    } finally {
      setPending(false);
    }
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
            {tenants.sort().map((slug) => {
              const isActive = slug === activeTenant;
              return (
                <DropdownMenuItem
                  key={slug}
                  onClick={() => handleSelect(slug)}
                  disabled={pending}
                  aria-checked={isActive}
                  className="flex items-center gap-2"
                >
                  <span className="flex-1 truncate">{formatTenantName(slug)}</span>
                  {isActive && (
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
