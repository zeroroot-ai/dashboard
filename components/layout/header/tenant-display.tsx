"use client";

/**
 * TenantDisplay
 *
 * Shows the currently active tenant name in the header.
 * Reads from TenantContextProvider which is mounted in the auth layout.
 */

import { useTenant } from "@/src/hooks/useTenant";
import { Skeleton } from "@/components/ui/skeleton";

function TenantName() {
  const { currentTenant, isLoading } = useTenant();

  if (isLoading) {
    return <Skeleton className="h-3 w-24 hidden md:inline-block" />;
  }

  const name = currentTenant?.displayName ?? "No workspace";

  return (
    <span className="text-xs text-muted-foreground font-mono hidden md:inline" title={`Active tenant: ${name}`}>
      {name}
    </span>
  );
}

export function TenantDisplay() {
  return <TenantName />;
}
