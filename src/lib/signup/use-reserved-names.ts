"use client";

import { useEffect, useState } from "react";

/**
 * Reserved-names denylist returned by GET /api/auth/reserved-names.
 * Spec: tenant-provisioning-unification-phase2 Requirement 4.5.
 */
export interface ReservedNamesDenylist {
  exact: string[];
  prefix: string[];
}

const EMPTY: ReservedNamesDenylist = { exact: [], prefix: [] };

/**
 * Fetches the chart-managed reserved-names denylist once on mount and
 * memoizes the result for the component's lifetime.
 *
 * Returns `EMPTY` while loading or on fetch failure — the K8s admission
 * webhook is the authoritative gate, so a missed client-side check
 * surfaces as a server-side rejection rather than letting the user
 * submit a reserved name.
 */
export function useReservedNames(): ReservedNamesDenylist {
  const [denylist, setDenylist] = useState<ReservedNamesDenylist>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/reserved-names", { method: "GET" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((data: ReservedNamesDenylist | null) => {
        if (cancelled || !data) return;
        setDenylist({
          exact: Array.isArray(data.exact) ? data.exact : [],
          prefix: Array.isArray(data.prefix) ? data.prefix : [],
        });
      })
      .catch(() => {
        // Silent — fall back to empty denylist; admission webhook is authoritative.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return denylist;
}
