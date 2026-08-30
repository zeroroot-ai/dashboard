"use client";

/**
 * RunningAgentsBadge, the live count of the tenant's running agents for the
 * sidebar entry (dashboard#1145). It polls through the shared query, so the
 * count updates without a page reload and renders nothing at zero.
 */

import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { useRunningAgents } from "@/src/hooks/useRunningAgents";

export function RunningAgentsBadge() {
  const { data } = useRunningAgents();
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <SidebarMenuBadge
      data-testid="running-agents-badge"
      className="border border-primary/40 font-mono tabular-nums text-primary peer-hover/menu-button:text-primary"
      aria-label={`${count} agents running`}
    >
      <span className="mr-1 inline-block size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-primary" aria-hidden="true" />
      {count}
    </SidebarMenuBadge>
  );
}
