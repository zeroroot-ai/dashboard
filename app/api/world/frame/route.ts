import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/frame?seq=N[&mission=ID]
 *
 * The Scroller's scrub primitive (epic ecs-brain, gibson#752). Returns the
 * World materialized at Timeline position `seq` — a server-side fold of the
 * log to that point (ADR-0001: World == fold(Timeline)), NOT a client-side
 * slice. `seq` is clamped daemon-side to [0, total]; seq == total is the live
 * World. An optional `mission` scopes the fold to one mission's slice of the
 * Timeline (gibson#1060): the frame then materializes only that mission's World
 * and `seq`/`total` index the mission's slice, matching the mission-scoped
 * timeline so the Scroller stays coherent. Tenant scoping is enforced by the
 * daemon's WorldService.
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

    const seqParam = req.nextUrl.searchParams.get('seq');
    const seq = BigInt(seqParam ? Math.max(0, Math.trunc(Number(seqParam))) : 0);
    const missionId = req.nextUrl.searchParams.get('mission') ?? '';

    const client = userClient(WorldService);
    const frame = await client.getFrameAt({ seq, missionId });

    return NextResponse.json({
      seq: Number(frame.seq),
      total: Number(frame.total),
      missions: frame.missions.map((m) => ({
        id: m.id,
        goal: m.goal,
        status: m.status,
        reason: m.reason,
      })),
      hosts: frame.hosts.map((h) => ({
        scopeId: h.scopeId,
        address: h.address,
        openPorts: h.openPorts,
        juicy: h.juicy,
        attention: h.attention,
        surprise: h.surprise,
      })),
      findings: frame.findings.map((f) => ({
        id: f.id,
        title: f.title,
        scopeId: f.scopeId,
        address: f.address,
        severity: f.severity,
      })),
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
