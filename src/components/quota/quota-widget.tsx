"use client";

/**
 * quota-widget.tsx, App-shell quota indicator. Spec
 * plans-and-quotas-simplification R9.B.3.
 *
 * Shows compact "X / Y" + thin progress bar for each enforced quota.
 * Hides any quota whose limit is 0 (unlimited / enterprise-deploy).
 * Color thresholds: gray < 80%, amber 80–99%, red ≥ 100%.
 */

import { useTenantQuotaUsage } from "@/src/lib/hooks/use-tenant-quota-usage";

type QuotaRowProps = {
  label: string;
  used: number;
  limit: number;
};

function rowColor(pct: number): string {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-muted-foreground/40";
}

function QuotaRow({ label, used, limit }: QuotaRowProps) {
  if (limit <= 0) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title={`${used} / ${limit} ${label} (${pct}%)`}
      data-testid={`quota-row-${label}`}
    >
      <span className="font-medium tabular-nums">
        {used}
        <span className="opacity-60">/{limit}</span>
      </span>
      <span className="hidden sm:inline">{label}</span>
      <div className="hidden sm:block w-16 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${rowColor(pct)} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export type QuotaWidgetProps = {
  /**
   * Plan limits to compare against. The dashboard's tenant context provides
   * these; the widget is dumb about where they come from.
   */
  missionsLimit: number;
  agentsLimit: number;
};

/**
 * QuotaWidget renders a compact quota indicator. Hides itself entirely
 * when both limits are 0 (e.g., enterprise-deploy).
 */
export function QuotaWidget({ missionsLimit, agentsLimit }: QuotaWidgetProps) {
  const { data, isLoading, error } = useTenantQuotaUsage();
  if (missionsLimit <= 0 && agentsLimit <= 0) return null;
  if (isLoading || error || !data) {
    // Render a minimal placeholder to avoid layout jank; do not display
    // numbers until usage is in.
    return (
      <div className="flex items-center gap-3 opacity-50" aria-hidden="true">
        <span className="text-xs text-muted-foreground">…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3" data-testid="quota-widget">
      <QuotaRow label="missions" used={data.missionsActive} limit={missionsLimit} />
      <QuotaRow label="agents" used={data.agentsActive} limit={agentsLimit} />
    </div>
  );
}
