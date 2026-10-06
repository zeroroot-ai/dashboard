// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AuthorizedNavGate — renders a menu entry only for a role that may call
 * the page's RPC. It hides the entry while the answer is loading, so the
 * entry never flashes for a role that may not open the page.
 */

import * as React from "react";

import { useAuthorize } from "@/src/lib/auth/use-authorize";

export function AuthorizedNavGate({
  method,
  children,
}: {
  /** The fully qualified RPC that the page needs. */
  method: string;
  children: React.ReactNode;
}) {
  const { allowed, loading } = useAuthorize(method);
  if (loading || !allowed) return null;
  return <>{children}</>;
}
