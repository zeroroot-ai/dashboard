// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * approaching-limit-banner.tsx, Renders a top-of-page banner when
 * either enforced quota crosses 80% usage. Spec
 * plans-and-quotas-simplification R9.B.4 / R9.B.5.
 *
 * Dismissable per session via sessionStorage; reappears on next login.
 * At ≥100% usage the banner copy switches to the "you're at the limit"
 * variant.
 */

import { useEffect, useState } from "react";

import type { AccountLink } from "@/src/lib/deployment-profile";
import { useTenantQuotaUsage } from "@/src/lib/hooks/use-tenant-quota-usage";

type ApproachingLimitBannerProps = {
  /** Plan limits; 0 = unlimited (suppresses the row). */
  missionsLimit: number;
  agentsLimit: number;
  /** Optional storage-key suffix so the missions and agents pages can
   * dismiss independently. */
  storageKeySuffix?: string;
  /** The account link from config (dashboard#226). Pass it from the
   * nearest server boundary (getDeploymentProfile().accountLink). With no
   * link (the self-hosted default) the quota warning still shows, but the
   * banner offers no action. Fail-closed: defaults to null. */
  accountLink?: AccountLink | null;
};

const STORAGE_KEY_BASE = "gibson:quota-banner-dismissed:";

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function ApproachingLimitBanner({
  missionsLimit,
  agentsLimit,
  storageKeySuffix = "",
  accountLink = null,
}: ApproachingLimitBannerProps) {
  const { data } = useTenantQuotaUsage();
  const [dismissed, setDismissed] = useState(false);
  const storageKey = STORAGE_KEY_BASE + (storageKeySuffix || "default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.sessionStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (!data || dismissed) return null;
  const missionsPct = pct(data.missionsActive, missionsLimit);
  const agentsPct = pct(data.agentsActive, agentsLimit);
  const maxPct = Math.max(missionsPct, agentsPct);
  if (maxPct < 80) return null;

  const atLimit = maxPct >= 100;
  // The account service owns plan changes; the banner only links to it.
  const upgrade = accountLink;

  const variant = atLimit
    ? "border-red-500 bg-red-50 text-red-900"
    : "border-amber-500 bg-amber-50 text-amber-900";

  return (
    <div
      role="status"
      data-testid="quota-approaching-limit-banner"
      className={`mb-4 border-l-4 px-4 py-3 rounded-md flex items-start gap-4 ${variant}`}
    >
      <div className="flex-grow text-sm">
        {missionsLimit > 0 && missionsPct >= 80 ? (
          <p>
            <span className="font-semibold tabular-nums">
              {data.missionsActive} / {missionsLimit}
            </span>{" "}
            concurrent missions in flight ({missionsPct}%).
          </p>
        ) : null}
        {agentsLimit > 0 && agentsPct >= 80 ? (
          <p>
            <span className="font-semibold tabular-nums">
              {data.agentsActive} / {agentsLimit}
            </span>{" "}
            concurrent agents bound to in-flight tasks ({agentsPct}%).
          </p>
        ) : null}
        <p className="mt-1 opacity-80">
          {atLimit
            ? "You've hit your plan limit. New work will be rejected until in-flight items complete."
            : "Approaching your plan limit."}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {upgrade ? (
          <a
            href={upgrade.url}
            className="text-sm font-semibold underline-offset-2 hover:underline"
            data-testid="quota-banner-upgrade-cta"
          >
            {upgrade.label} →
          </a>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss"
          className="text-sm opacity-60 hover:opacity-100"
          onClick={() => {
            try {
              window.sessionStorage.setItem(storageKey, "1");
            } catch {
              // sessionStorage may be unavailable (rare); fall back to
              // in-memory dismissal for the current page mount.
            }
            setDismissed(true);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
