// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * The ADR-0122 reliability diagram (gibson#284, dashboard#98): the visible
 * proof that Gibson's confidence numbers are real, not high/medium/low theater.
 * It plots predicted probability against observed frequency from settled bets,
 * filterable by technique and by bin resolution.
 *
 * The seam `WorldService.GetCalibration` takes only a bin count, so the two
 * live filters are technique (the tenant-wide summary or one technique's bets)
 * and resolution (how many predicted-probability buckets the curve is drawn
 * over). A time-range filter waits on a gibson-side request field; it is not
 * stubbed here, because a control the backend cannot honor is worse than none.
 */

import * as React from 'react';
import { GaugeIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';
import { EmptyState } from '@/components/gibson/shared/EmptyState';
import { TableSkeleton } from '@/components/gibson/shared/DataSkeleton';
import { ReliabilityDiagram } from '@/components/gibson/reliability/ReliabilityDiagram';
import { useCalibration } from '@/src/hooks/useCalibration';
import type { CalibrationReport, TechniqueCalibration } from '@/src/types/calibration';

const OVERALL_VALUE = '__overall__';
const RESOLUTIONS = [5, 10, 20] as const;

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function pickSelected(
  report: CalibrationReport,
  technique: string,
): TechniqueCalibration | null {
  if (technique === OVERALL_VALUE) return report.overall;
  return report.byTechnique.find((t) => t.technique === technique) ?? report.overall;
}

export function ReliabilityDiagramContent() {
  const [technique, setTechnique] = React.useState<string>(OVERALL_VALUE);
  const [bins, setBins] = React.useState<number>(10);

  const { data, isLoading, error } = useCalibration(bins);

  const selected = data ? pickSelected(data, technique) : null;
  const hasCurve = !!selected && selected.bins.some((b) => b.n > 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GaugeIcon className="size-6 text-highlight" /> Reliability diagram
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          When the fleet stakes a bet at 80% confidence, does it come true 80% of the time? Every
          point below is a bucket of settled bets: its predicted probability against what actually
          happened. The dashed diagonal is perfect calibration. This reads from settled bets, not
          from a label.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Technique
          </span>
          <Select value={technique} onValueChange={setTechnique}>
            <SelectTrigger className="w-56" data-testid="reliability-technique-select">
              <SelectValue placeholder="All techniques" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OVERALL_VALUE}>All techniques</SelectItem>
              {data?.byTechnique.map((t) => (
                <SelectItem key={t.technique} value={t.technique}>
                  {t.technique}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resolution
          </span>
          <Select value={String(bins)} onValueChange={(v) => setBins(Number(v))}>
            <SelectTrigger className="w-32" data-testid="reliability-bins-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOLUTIONS.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r} buckets
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div data-testid="reliability-skeleton">
          <TableSkeleton rows={4} cols={1} />
        </div>
      )}

      {!isLoading && error && (
        <ErrorAlert title="Failed to load the reliability report" error={error} />
      )}

      {!isLoading && !error && data && !hasCurve && (
        <EmptyState
          icon={GaugeIcon}
          title="No settled bets to score yet"
          description="A reliability diagram needs settled, staked bets. As missions run and bets settle, the curve appears here. Nothing to show is not an error."
        />
      )}

      {!isLoading && !error && data && selected && hasCurve && (
        <Card className="border-border">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-highlight/40 bg-highlight/10 font-mono text-xs uppercase tracking-wide text-highlight">
                {selected.technique === '' ? 'all techniques' : selected.technique}
              </Badge>
              <Badge className="border border-border bg-muted/60 font-mono text-xs text-muted-foreground">
                {selected.n} settled bet{selected.n === 1 ? '' : 's'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[auto_1fr]">
            <ReliabilityDiagram data={selected} />
            <div className="grid grid-cols-2 gap-4 self-start sm:grid-cols-2">
              <Stat label="Brier score" value={selected.brierScore.toFixed(3)} />
              <Stat label="Mean predicted" value={pct(selected.meanPredicted)} />
              <Stat label="Observed" value={pct(selected.observedFrequency)} />
              <Stat label="Unscored (tenant)" value={String(data.unscored)} />
              <div className="col-span-2 text-xs text-muted-foreground">
                Brier score is the mean squared error of prediction against outcome. 0 is perfect
                calibration; lower is better.
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
