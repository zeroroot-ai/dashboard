// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * SpendView, first-class spend breakdown for a run (gibson#755).
 *
 * Answers "where did the money go" using the already-aggregated TokenSummary:
 * a by-model table (model, calls, tokens), sorted by tokens so the large
 * contributors are obvious. The headline totals strip is rendered by
 * RunView above this. The World call log attributes calls by model only, so
 * there is no by-agent breakdown. The table shows no cost: the call list has
 * no cost field, and the dashboard does not estimate one.
 */

import { formatTokenCount } from "@/src/lib/world-traces";
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
    (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
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
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-highlight/20">
                <Th>Model</Th>
                <Th right>Calls</Th>
                <Th right>Tokens (in/out)</Th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
