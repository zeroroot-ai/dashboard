// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { getHitlSettleClient } from '@/src/lib/hitl-settle/client';
import type { BetVerdict } from '@/src/types/hitl-settle';

/**
 * /api/world/bet-settlements — the ADR-0023 HITL settle surface (gibson#264/
 * #266/#280, dashboard#97), backed by `WorldService.ListOpenBets` +
 * `WorldService.SettleBetByHITL` over Envoy + ext-authz.
 *
 * GET  returns the caller's tenant's OPEN bets: the hypothesis, its evidence,
 *      and the proposing agent's run (for the Gibson Traces transcript link).
 *      Read-only; judging is always asynchronous — this NEVER blocks a running
 *      mission (ADR-0008).
 * POST records one human's verdict (true_positive / false_positive / dismiss)
 *      for a specific bet. true_positive/false_positive settle the bet;
 *      dismiss records a label without settling (the daemon's own rule).
 */
const VERDICTS = new Set<BetVerdict>(['true_positive', 'false_positive', 'dismiss']);

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const items = await getHitlSettleClient().listOpenBets();
    return NextResponse.json({ items });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const body = (await req.json()) as {
      id?: string;
      verdict?: string;
    };

    if (!body.id) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'id is required' } },
        { status: 400 },
      );
    }
    if (!body.verdict || !VERDICTS.has(body.verdict as BetVerdict)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'verdict must be true_positive, false_positive, or dismiss',
          },
        },
        { status: 400 },
      );
    }

    const result = await getHitlSettleClient().submitVerdict(body.id, body.verdict as BetVerdict);
    return NextResponse.json(result);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
