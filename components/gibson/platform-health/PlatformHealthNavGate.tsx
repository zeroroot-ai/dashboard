// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Renders the Platform health menu entry only for a caller that may read
 * the platform health, the Platform owner (hosted#174). The RPC carries the
 * platform_owner relation on the system tenant, which no tenant role
 * decides, so the gate reads it and shows the entry only when the read
 * succeeds. The entry is hidden while the read is in flight.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { getPlatformHealthAction } from "@/app/actions/platform-health";
import { PLATFORM_HEALTH_QUERY_KEY } from "./PlatformHealthContent";

export function PlatformHealthNavGate({ children }: { children: React.ReactNode }) {
  const health = useQuery({
    queryKey: PLATFORM_HEALTH_QUERY_KEY,
    queryFn: () => getPlatformHealthAction(),
    staleTime: 60_000,
    retry: false,
  });
  if (!health.data?.ok) return null;
  return <>{children}</>;
}
