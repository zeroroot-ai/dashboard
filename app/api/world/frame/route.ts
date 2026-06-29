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
      // The mission's WorkItems reconstructed as-of the fold (PRD #1059 M2,
      // gibson#1061): in-flight (status "running") + terminal work. Mission-
      // scoped when `mission` is set; all tenant work otherwise.
      work: frame.work.map((w) => ({
        id: w.id,
        missionId: w.missionId,
        kind: w.kind,
        target: w.target,
        status: w.status,
      })),
      // The mission's Decider decisions reconstructed as-of the fold (PRD #1059
      // M2, gibson#1062): what the brain chose to do next at each decision point
      // and why. A decision appears at its request tick ("pending") and reaches
      // "completed" at its completion tick. Mission-scoped when `mission` is set;
      // all tenant decisions otherwise.
      decisions: frame.decisions.map((d) => ({
        id: d.id,
        missionId: d.missionId,
        cursor: Number(d.cursor),
        status: d.status,
        dispatches: d.dispatches.map((dd) => ({
          workId: dd.workId,
          kind: dd.kind,
          target: dd.target,
        })),
        outcome: d.outcome,
        rationale: d.rationale,
      })),
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
