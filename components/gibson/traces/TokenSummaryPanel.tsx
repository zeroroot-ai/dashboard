"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokenCount, formatUsd } from "@/src/lib/trace-utils";
import type { TokenSummary } from "@/src/types/trace";
import { formatDuration } from "./TraceTree";

/**
 * TokenSummaryPanel renders a TokenSummary as a top-level totals strip plus
 * by-model and by-agent breakdown tables. Shared between the mission Traces
 * tab and the standalone trace detail page (dashboard#470) — there is one
 * token-summary renderer.
 *
 * `totalDurationMs` is the trace-level wall-clock duration (not part of
 * TokenSummary); when supplied it is shown alongside the token totals so the
 * panel fully subsumes the old inline summary line.
 */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-mono font-medium tabular-nums text-highlight">
        {value}
      </div>
    </div>
  );
}

export interface TokenSummaryPanelProps {
  summary: TokenSummary;
  totalDurationMs?: number;
}

export function TokenSummaryPanel({
  summary,
  totalDurationMs,
}: TokenSummaryPanelProps) {
  return (
    <div className="glass-hack rounded-lg p-3 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total tokens" value={formatTokenCount(summary.totalTokens)} />
        <Stat label="Input" value={formatTokenCount(summary.inputTokens)} />
        <Stat label="Output" value={formatTokenCount(summary.outputTokens)} />
        <Stat label="Est. cost" value={formatUsd(summary.estimatedCostUsd)} />
        <Stat label="LLM calls" value={summary.llmCallCount.toLocaleString()} />
        {totalDurationMs != null && (
          <Stat label="Duration" value={formatDuration(totalDurationMs)} />
        )}
      </div>

      {summary.byModel.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            By model
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byModel.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-mono text-xs">{row.model}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.totalTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.callCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUsd(row.estimatedCostUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {summary.byAgent.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            By agent
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byAgent.map((row) => (
                <TableRow key={row.agentName}>
                  <TableCell className="font-mono text-xs">{row.agentName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTokenCount(row.totalTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.callCount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
