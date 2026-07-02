import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * /api/world/review — the HITL review/label queue (epic ecs-brain, gibson#753).
 *
 * GET  returns the caller's tenant's review queue: surfaced surprises + Findings,
 *      each with any label already applied. Read-only; this NEVER gates a mission.
 * POST submits a label (true/false-positive, severity, category, dismiss) for one
 *      item. The daemon appends a tenant-scoped label event and returns — async,
 *      non-blocking. Labels pool across the tenant's users and never cross tenants
 *      (enforced daemon-side by gibson.world.v1.WorldService; the dashboard never
 *      touches the brain directly).
 */
const VERDICTS = new Set(['true_positive', 'false_positive', 'dismiss']);

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const client = userClient(WorldService);
    const queue = await client.listReviewQueue({});

    return NextResponse.json({
      items: queue.items.map((it) => ({
        targetId: it.targetId,
        kind: it.kind,
        title: it.title,
        scopeId: it.scopeId,
        address: it.address,
        severity: it.severity,
        labelled: it.labelled,
        label: it.label
          ? {
              verdict: it.label.verdict,
              severity: it.label.severity,
              category: it.label.category,
              userId: it.label.userId,
            }
          : null,
      })),
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const body = (await req.json()) as {
      targetId?: string;
      verdict?: string;
      severity?: string;
      category?: string;
    };

    if (!body.targetId) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'targetId is required' } },
        { status: 400 },
      );
    }
    if (!body.verdict || !VERDICTS.has(body.verdict)) {
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

    // The daemon stamps the labelling user from the SPIFFE identity chain
    // server-side; the dashboard never supplies a user id (no cross-user
    // attribution). The call returns immediately — labelling is async.
    const client = userClient(WorldService);
    await client.submitLabel({
      targetId: body.targetId,
      verdict: body.verdict,
      severity: body.severity ?? '',
      category: body.category ?? '',
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
