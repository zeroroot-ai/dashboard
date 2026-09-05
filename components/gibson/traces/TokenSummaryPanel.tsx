"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokenCount, formatUsd } from "@/src/lib/world-traces";
import type { TokenSummary } from "@/src/types/trace";

/**
 * TokenSummaryPanel renders a TokenSummary as a top-level totals strip plus a
 * by-model breakdown table (gibson#755). The World call log attributes calls by
 * model only, so there is no by-agent breakdown.
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

interface TokenSummaryPanelProps {
  summary: TokenSummary;
}

export function TokenSummaryPanel({ summary }: TokenSummaryPanelProps) {
  return (
    <div className="glass-hack rounded-lg p-3 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total tokens" value={formatTokenCount(summary.totalTokens)} />
        <Stat label="Input" value={formatTokenCount(summary.inputTokens)} />
        <Stat label="Output" value={formatTokenCount(summary.outputTokens)} />
        <Stat label="Est. cost" value={formatUsd(summary.estimatedCostUsd)} />
        <Stat label="LLM calls" value={summary.llmCallCount.toLocaleString()} />
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
    </div>
  );
}
