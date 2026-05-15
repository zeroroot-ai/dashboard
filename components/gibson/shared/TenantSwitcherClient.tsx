"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { Membership } from "@/src/lib/auth/membership";
import { switchActiveTenantAction } from "./tenant-switcher-action";

const ROLE_BADGE_CLASSES: Record<Membership["role"], string> = {
  owner: "border-alt/40/50 text-alt",
  admin: "border-highlight/50 text-highlight",
  member: "border-border/50 text-muted-foreground",
};

function RoleBadge({ role }: { role: Membership["role"] }) {
  return (
    <Badge
      variant="outline"
      className={`ml-1 px-1.5 py-0 text-[10px] font-mono capitalize ${ROLE_BADGE_CLASSES[role]}`}
    >
      {role}
    </Badge>
  );
}

interface TenantSwitcherClientProps {
  memberships: Membership[];
  activeTenantId?: string | undefined;
}

export function TenantSwitcherClient({
  memberships,
  activeTenantId,
}: TenantSwitcherClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const active = memberships.find((m) => m.tenantId === activeTenantId);

  function handleSwitch(tenantId: string) {
    if (tenantId === activeTenantId) return;
    startTransition(async () => {
      const result = await switchActiveTenantAction(tenantId);
      if (result.ok) {
        router.refresh();
      }
      // On failure (rare — usually means membership was just revoked), the
      // next refresh will route to /select-tenant via middleware.
    });
  }

  const triggerLabel = active?.tenantName ?? activeTenantId ?? "Select organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          className="h-7 gap-1 border-border bg-muted/50 px-2 text-xs font-mono text-muted-foreground hover:bg-muted hover:text-muted-foreground"
        >
          <span className="max-w-[140px] truncate">{triggerLabel}</span>
          {active && <RoleBadge role={active.role} />}
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {memberships.map((m) => {
          const isActive = m.tenantId === activeTenantId;
          return (
            <DropdownMenuItem
              key={m.tenantId}
              onSelect={() => handleSwitch(m.tenantId)}
              className="flex items-center justify-between gap-2 font-mono text-xs"
            >
              <span className="flex items-center gap-2 truncate">
                <Check
                  className={`h-3 w-3 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{m.tenantName}</span>
              </span>
              <RoleBadge role={m.role} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
