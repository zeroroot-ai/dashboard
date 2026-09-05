"use client";

/**
 * SpendView, first-class spend breakdown for a run (gibson#755).
 *
 * Answers "where did the money go" using the already-aggregated TokenSummary:
 * a by-model table (model, calls, tokens, est. cost), sorted descending so the
 * expensive contributors are obvious. The headline totals strip is rendered by
 * RunView above this. The World call log attributes calls by model only, so
 * there is no by-agent breakdown. Costs are estimated from a static price table.
 */

import { formatTokenCount, formatUsd } from "@/src/lib/world-traces";
import type { TokenSummary } from "@/src/types/trace";

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`pb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function SpendView({ summary }: { summary: TokenSummary }) {
  const byModel = [...summary.byModel].sort(
    (a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens,
  );

  if (byModel.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No spend was recorded for this run.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {byModel.length > 0 && (
        <div className="glass-hack rounded-lg p-3">
          <div className="flex items-center justify-between pb-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              By model
            </span>
            <span className="text-[10px] text-muted-foreground">
              costs are estimates
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-highlight/20">
                <Th>Model</Th>
                <Th right>Calls</Th>
                <Th right>Tokens (in/out)</Th>
                <Th right>Cost (est.)</Th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.model} className="border-b border-highlight/10">
                  <td className="py-1.5 font-mono">{m.model}</td>
                  <td className="py-1.5 text-right tabular-nums">{m.callCount}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {formatTokenCount(m.inputTokens)}/
                    {formatTokenCount(m.outputTokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {m.estimatedCostUsd > 0 ? formatUsd(m.estimatedCostUsd) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
