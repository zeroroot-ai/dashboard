"use client";

import { useSession } from "@/src/lib/session-client";
import { signOutAction } from "@/app/actions/auth/signout";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Role = "owner" | "admin" | "operator" | "viewer";

const ROLE_BADGE_CLASSES: Record<Role, string> = {
  owner: "border-amber-500/50 text-amber-400",
  admin: "border-green-500/50 text-green-400",
  operator: "border-blue-500/50 text-blue-400",
  viewer: "border-zinc-500/50 text-zinc-400",
};

function roleBadgeClasses(role: string | undefined): string {
  if (role && role in ROLE_BADGE_CLASSES) {
    return ROLE_BADGE_CLASSES[role as Role];
  }
  return ROLE_BADGE_CLASSES.viewer;
}

function RoleBadge({ role }: { role: string | undefined }) {
  return (
    <Badge
      variant="outline"
      className={`ml-1 px-1.5 py-0 text-[10px] font-mono capitalize ${roleBadgeClasses(role)}`}
    >
      {role ?? "viewer"}
    </Badge>
  );
}

export function TenantSwitcher() {
  const { data: session } = useSession();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  const tenants: string[] = s?.user?.tenants ?? [];
  const activeTenantId: string | null | undefined = s?.user?.tenantId;
  const rolesByTenant: Record<string, string> = s?.user?.rolesByTenant ?? {};

  if (tenants.length <= 1) {
    return null;
  }

  async function handleSwitch(tenantId: string) {
    if (tenantId === activeTenantId) return;

    // /api/tenant/select writes the gibson_current_tenant cookie which
    // middleware.ts forwards as X-Gibson-Tenant on every subsequent request.
    await fetch("/api/tenant/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant: tenantId }),
    });

    router.refresh();
  }

  const activeRole = activeTenantId ? rolesByTenant[activeTenantId] : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-zinc-700 bg-zinc-900/50 px-2 text-xs font-mono text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span className="max-w-[120px] truncate">{activeTenantId ?? "Select tenant"}</span>
          <RoleBadge role={activeRole} />
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {tenants.map((tenantId) => {
          const role = rolesByTenant[tenantId];
          const isActive = tenantId === activeTenantId;

          return (
            <DropdownMenuItem
              key={tenantId}
              onSelect={() => handleSwitch(tenantId)}
              className="flex items-center justify-between gap-2 font-mono text-xs"
            >
              <span className="flex items-center gap-2 truncate">
                <Check
                  className={`h-3 w-3 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{tenantId}</span>
              </span>
              <RoleBadge role={role} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
