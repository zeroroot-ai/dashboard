// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import type { TechniqueCalibrationView } from '@/src/gen/gibson/world/v1/world_pb';
import type { CalibrationReport, TechniqueCalibration } from '@/src/types/calibration';

/**
 * /api/world/calibration — the ADR-0022 reliability/calibration report
 * (gibson#284, dashboard#98).
 *
 * GET returns the caller's tenant's reliability report from settled, staked
 *     bets: a tenant-wide summary plus a per-technique breakdown, each with a
 *     Brier score and a binned reliability-diagram curve. Read-only; the daemon
 *     resolves the tenant server-side and reads only that tenant's brain
 *     (WorldService over Envoy + ext-authz). `bins` picks the curve resolution
 *     (<= 0 lets the daemon use its default deciles).
 */

/** Bound the requested bin count so a bad query cannot ask for a pathological curve. */
const MAX_BINS = 50;

function mapTechnique(view: TechniqueCalibrationView): TechniqueCalibration {
  return {
    technique: view.technique,
    n: view.n,
    meanPredicted: view.meanPredicted,
    observedFrequency: view.observedFrequency,
    brierScore: view.brierScore,
    bins: view.bins.map((b) => ({
      low: b.low,
      high: b.high,
      n: b.n,
      meanPredicted: b.meanPredicted,
      observedFrequency: b.observedFrequency,
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const binsParam = req.nextUrl.searchParams.get('bins');
    const parsed = binsParam ? Math.trunc(Number(binsParam)) : 0;
    // <= 0 means "server default"; clamp the upper bound only.
    const bins = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_BINS) : 0;

    const client = userClient(WorldService);
    const report = await client.getCalibration({ bins });

    const body: CalibrationReport = {
      tenant: report.tenant,
      overall: report.overall ? mapTechnique(report.overall) : null,
      byTechnique: report.byTechnique.map(mapTechnique),
      unscored: report.unscored,
      bins,
    };

    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
