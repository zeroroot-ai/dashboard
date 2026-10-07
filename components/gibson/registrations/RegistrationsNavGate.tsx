// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * RegistrationsNavGate — renders the "Registrations" menu entry only for a
 * caller that may read the registration queue (dashboard#193).
 *
 * The queue RPC carries the "platform_owner" relation on the system tenant.
 * The dashboard cannot decide that relation from a tenant role, so the gate
 * reads the queue and shows the entry only when the read succeeds. It hides
 * the entry while the read is in flight, so the entry never flashes.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { listPendingRegistrationsAction } from "@/app/actions/registrations";
import { REGISTRATIONS_QUERY_KEY } from "./query-key";

export function RegistrationsNavGate({ children }: { children: React.ReactNode }) {
  const queue = useQuery({
    queryKey: REGISTRATIONS_QUERY_KEY,
    queryFn: () => listPendingRegistrationsAction(),
    staleTime: 60_000,
    retry: false,
  });
  if (!queue.data?.ok) return null;
  return <>{children}</>;
}
