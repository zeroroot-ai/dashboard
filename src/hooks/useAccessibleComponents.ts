// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";
import type { AccessScopeSelection } from "@/components/gibson/shared/AccessScopeSelector";

type Kind = "plugin" | "tool" | "agent" | "connector";

/**
 * The components of one kind that a scope can reach, as matrix rows. The
 * agents, tools, plugins and connectors pages share it.
 *
 * Loading and the error derive during render from the scope of the last
 * load that ended, so the effect sets state only when a load ends
 * (react-hooks/set-state-in-effect). The previous rows stay on screen while
 * a new scope loads.
 *
 * `toItem` must be a stable function (a module-level function), because a
 * new one does not start a new load.
 */
export function useAccessibleComponents<T>(
  kind: Kind,
  scope: AccessScopeSelection,
  toItem: (d: DiscoveredItem, scope: AccessScopeSelection["scope"]) => T,
): {
  items: T[];
  setItems: (next: T[] | ((prev: T[]) => T[])) => void;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [loaded, setLoaded] = useState<{
    scope: AccessScopeSelection;
    items: T[];
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fail = (err: Error) =>
      setLoaded((prev) => ({ scope, items: prev?.items ?? [], error: err }));
    listAccessibleComponentsAction({ kind, scope: scope.scope, targetId: scope.targetId })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setLoaded({ scope, items: r.data.map((d) => toItem(d, scope.scope)), error: null });
        } else {
          fail(new Error(r.error));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) fail(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
    // toItem is a stable module-level function; see the doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, scope]);

  const setItems = useCallback(
    (next: T[] | ((prev: T[]) => T[])) =>
      setLoaded((prev) => ({
        scope: prev?.scope ?? scope,
        items: typeof next === "function" ? next(prev?.items ?? []) : next,
        error: prev?.error ?? null,
      })),
    [scope],
  );

  // A reload after a change. It keeps the rows on screen and replaces them
  // when the read succeeds, as the pages did before.
  const refetch = useCallback(async () => {
    const r = await listAccessibleComponentsAction({
      kind,
      scope: scope.scope,
      targetId: scope.targetId,
    });
    if (r.ok) setItems(r.data.map((d) => toItem(d, scope.scope)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, scope, setItems]);

  return {
    items: loaded?.items ?? [],
    setItems,
    loading: loaded?.scope !== scope,
    error: loaded?.scope === scope ? loaded.error : null,
    refetch,
  };
}
