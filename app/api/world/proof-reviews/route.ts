// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { listProofReviews } from '@/src/lib/proof-reviews/client';

/**
 * /api/world/proof-reviews (dashboard#228), backed by
 * `WorldService.ListProofReviews` over Envoy and ext-authz.
 *
 * GET returns one page of the proofs that wait for a human review, with the
 * evidence of each one. `?pageToken=` continues from the previous page. The
 * verdict on a proof is a verdict on its bet, so it goes through
 * POST /api/world/bet-settlements.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const pageToken = req.nextUrl.searchParams.get('pageToken') ?? '';
    if (pageToken.length > 1024) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'pageToken is too long' } },
        { status: 400 },
      );
    }
    return NextResponse.json(await listProofReviews(pageToken));
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
