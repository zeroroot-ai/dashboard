// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 2 of the first screen: the exposure window and the revert rate
 * (dashboard#384). The daemon computes each number. The panel shows the median
 * exposure window of the findings verified in the last week with its split
 * into agent time and wait time, and the revert rate of the merged fixes, each
 * next to the week before. A week with no verified finding, and a week with no
 * merged fix, show an empty text and never a zero.
 */

import * as React from "react";
import { TimerIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useExposure } from "@/src/hooks/useExposure";
import {
  formatRate,
  formatSeconds,
  medianChange,
  revertChange,
  type Direction,
} from "@/src/lib/exposure/exposure";
import { EXPOSURE_TEXT } from "./texts";

const DIRECTION_TEXT: Record<Direction, string> = {
  up: EXPOSURE_TEXT.up,
  down: EXPOSURE_TEXT.down,
  same: EXPOSURE_TEXT.same,
};

export function ExposurePanel() {
  const { data, isLoading, error, refetch } = useExposure();

  let body: React.ReactNode;
  if (isLoading) {
    body = <TableSkeleton rows={2} cols={2} />;
  } else if (error || !data) {
    body = (
      <ErrorAlert
        error={error ?? new Error(EXPOSURE_TEXT.loadFailed)}
        title={EXPOSURE_TEXT.loadFailed}
        retry={() => void refetch()}
      />
    );
  } else {
    const { exposure, revert } = data;
    const change = medianChange(exposure);
    const rChange = revertChange(revert);
    body = (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="space-y-1" data-testid="exposure-window">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            {EXPOSURE_TEXT.windowTitle}
          </h3>
          {exposure.count === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="exposure-empty">
              {EXPOSURE_TEXT.noVerified}
            </p>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums" data-testid="exposure-median">
                {formatSeconds(exposure.medianSeconds)}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="exposure-split">
                {EXPOSURE_TEXT.agentTime}: {formatSeconds(exposure.medianAgentSeconds)}.{" "}
                {EXPOSURE_TEXT.waitTime}: {formatSeconds(exposure.medianWaitSeconds)}.
              </p>
              <p className="text-xs text-muted-foreground" data-testid="exposure-trend">
                {change
                  ? EXPOSURE_TEXT.trend(
                      DIRECTION_TEXT[change.direction],
                      formatSeconds(Math.abs(change.seconds)),
                      formatSeconds(exposure.previousMedianSeconds),
                    )
                  : EXPOSURE_TEXT.noPrevious}
              </p>
              <p className="text-xs text-muted-foreground">{EXPOSURE_TEXT.verifiedCount(exposure.count)}</p>
            </>
          )}
        </section>
        <section className="space-y-1" data-testid="revert-rate">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            {EXPOSURE_TEXT.revertTitle}
          </h3>
          {revert.current.merged === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="revert-empty">
              {EXPOSURE_TEXT.noMerged}
            </p>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums" data-testid="revert-value">
                {formatRate(revert.current.rate)}
              </p>
              <p className="text-xs text-muted-foreground">
                {EXPOSURE_TEXT.revertCounts(revert.current.reverted, revert.current.merged)}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="revert-trend">
                {rChange
                  ? EXPOSURE_TEXT.revertTrend(
                      DIRECTION_TEXT[rChange.direction],
                      Math.abs(rChange.points),
                      formatRate(revert.previous.rate),
                    )
                  : EXPOSURE_TEXT.noPrevious}
              </p>
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <Card className="glass-hack border-highlight/40" data-testid="panel-exposure">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {EXPOSURE_TEXT.title}
          </CardTitle>
          <TimerIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
        </div>
        <p className="text-xs text-muted-foreground">{EXPOSURE_TEXT.period}</p>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
