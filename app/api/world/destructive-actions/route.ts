// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { getDestructiveActionsClient } from '@/src/lib/destructive-actions/client';
import type { DestructiveActionDecision } from '@/src/types/destructive-actions';

/**
 * /api/world/destructive-actions — the ADR-0028 destructive-action
 * authorization queue (gibson#278/#336, dashboard#99), backed by
 * `DestructiveAuthorizationService` over Envoy + ext-authz.
 *
 * GET  returns the caller's tenant's pending destructive actions: what each
 *      one would do, its blast radius, its reversibility, the predicate it
 *      would satisfy, and the hypothesis/bet it belongs to. Read-only; this
 *      NEVER blocks the rest of the mission — only the one gated action
 *      waits (ADR-0028 §2).
 * POST records one human's approve/deny decision for a specific pending
 *      action. Per-action, not per-mission: the decision never touches any
 *      other pending action or the mission's own state.
 */
const DECISIONS = new Set<DestructiveActionDecision>(['approve', 'deny']);

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const items = await getDestructiveActionsClient().listPending();
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
      decision?: string;
    };

    if (!body.id) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'id is required' } },
        { status: 400 },
      );
    }
    if (!body.decision || !DECISIONS.has(body.decision as DestructiveActionDecision)) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'decision must be approve or deny' } },
        { status: 400 },
      );
    }

    await getDestructiveActionsClient().decide(body.id, body.decision as DestructiveActionDecision);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
