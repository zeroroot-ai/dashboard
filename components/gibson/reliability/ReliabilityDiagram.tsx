// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * The reliability-diagram plot (ADR-0022, gibson#284, dashboard#98): predicted
 * probability on x, observed frequency on y, one point per predicted-probability
 * bucket. The diagonal is perfect calibration — a point above it means the
 * fleet was under-confident in that bucket, below means over-confident. Point
 * area scales with how many settled bets landed in the bucket, so a sparse
 * bucket does not read as loud as a dense one.
 *
 * Colors come only from design tokens: SVG marks paint with `currentColor` and
 * inherit it from a text-* utility class, so the chart tracks light and dark
 * mode with no hardcoded values.
 */

import * as React from 'react';
import type { CalibrationBin, TechniqueCalibration } from '@/src/types/calibration';

const WIDTH = 360;
const HEIGHT = 320;
const PAD_LEFT = 44;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

function xPix(p: number): number {
  return PAD_LEFT + Math.min(Math.max(p, 0), 1) * PLOT_W;
}

function yPix(f: number): number {
  return PAD_TOP + (1 - Math.min(Math.max(f, 0), 1)) * PLOT_H;
}

function pointRadius(n: number, maxN: number): number {
  if (maxN <= 0) return 4;
  return 4 + 6 * Math.sqrt(n / maxN);
}

export function ReliabilityDiagram({ data }: { data: TechniqueCalibration }) {
  const filled: CalibrationBin[] = data.bins.filter((b) => b.n > 0);
  const maxN = filled.reduce((m, b) => Math.max(m, b.n), 0);
  const curve = filled
    .map((b) => `${xPix(b.meanPredicted).toFixed(1)},${yPix(b.observedFrequency).toFixed(1)}`)
    .join(' ');

  const label = data.technique === '' ? 'all techniques' : data.technique;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full max-w-md text-foreground"
      role="img"
      aria-label={`Reliability diagram for ${label}: predicted probability against observed frequency across ${filled.length} buckets`}
      data-testid="reliability-diagram"
    >
      {/* Plot frame */}
      <rect
        x={PAD_LEFT}
        y={PAD_TOP}
        width={PLOT_W}
        height={PLOT_H}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        className="text-border"
      />

      {/* Grid + ticks */}
      <g className="text-muted-foreground" stroke="currentColor" strokeOpacity={0.15}>
        {TICKS.map((t) => (
          <React.Fragment key={`grid-${t}`}>
            <line x1={xPix(t)} y1={PAD_TOP} x2={xPix(t)} y2={PAD_TOP + PLOT_H} />
            <line x1={PAD_LEFT} y1={yPix(t)} x2={PAD_LEFT + PLOT_W} y2={yPix(t)} />
          </React.Fragment>
        ))}
      </g>
      <g className="fill-muted-foreground text-[10px]">
        {TICKS.map((t) => (
          <React.Fragment key={`tick-${t}`}>
            <text x={xPix(t)} y={PAD_TOP + PLOT_H + 14} textAnchor="middle">
              {t}
            </text>
            <text x={PAD_LEFT - 6} y={yPix(t) + 3} textAnchor="end">
              {t}
            </text>
          </React.Fragment>
        ))}
      </g>

      {/* Perfect-calibration diagonal */}
      <line
        x1={xPix(0)}
        y1={yPix(0)}
        x2={xPix(1)}
        y2={yPix(1)}
        stroke="currentColor"
        strokeOpacity={0.5}
        strokeDasharray="4 4"
        className="text-muted-foreground"
        data-testid="reliability-diagonal"
      />

      {/* Reliability curve */}
      {curve && (
        <polyline
          points={curve}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-highlight"
          data-testid="reliability-curve"
        />
      )}

      {/* Per-bucket points */}
      {filled.map((b, i) => (
        <circle
          key={`pt-${i}`}
          cx={xPix(b.meanPredicted)}
          cy={yPix(b.observedFrequency)}
          r={pointRadius(b.n, maxN)}
          fill="currentColor"
          fillOpacity={0.75}
          className="text-primary"
          data-testid={`reliability-point-${i}`}
          data-n={b.n}
        >
          <title>
            {`predicted ${(b.meanPredicted * 100).toFixed(0)}%, observed ${(b.observedFrequency * 100).toFixed(0)}% (${b.n} bet${b.n === 1 ? '' : 's'})`}
          </title>
        </circle>
      ))}

      {/* Axis titles */}
      <text
        x={PAD_LEFT + PLOT_W / 2}
        y={HEIGHT - 4}
        textAnchor="middle"
        className="fill-foreground text-[11px]"
      >
        Predicted probability
      </text>
      <text
        x={12}
        y={PAD_TOP + PLOT_H / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${PAD_TOP + PLOT_H / 2})`}
        className="fill-foreground text-[11px]"
      >
        Observed frequency
      </text>
    </svg>
  );
}
