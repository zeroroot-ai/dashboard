import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world
 *
 * The dashboard's read path into the ECS brain (epic ecs-brain, gibson#752).
 * Reads the caller's tenant's live World (missions, hosts, findings) + the
 * domain-event Timeline (the Scroller scrubs this). Tenant scoping is enforced
 * by the daemon's WorldService — the dashboard never touches the brain directly.
 */
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
    const [missions, hosts, findings, llmCalls, timeline] = await Promise.all([
      client.listMissions({}),
      client.listHosts({}),
      client.listFindings({}),
      client.listLlmCalls({}),
      client.getTimeline({}),
    ]);

    return NextResponse.json({
      missions: missions.missions.map((m) => ({
        id: m.id,
        goal: m.goal,
        status: m.status,
        reason: m.reason,
      })),
      hosts: hosts.hosts.map((h) => ({
        scopeId: h.scopeId,
        address: h.address,
        openPorts: h.openPorts,
        juicy: h.juicy,
        attention: h.attention,
        surprise: h.surprise,
      })),
      findings: findings.findings.map((f) => ({
        id: f.id,
        title: f.title,
        scopeId: f.scopeId,
        address: f.address,
        severity: f.severity,
      })),
      llmCalls: llmCalls.llmCalls.map((c) => ({
        callId: c.callId,
        runId: c.runId,
        model: c.model,
        promptTokens: c.promptTokens,
        completionTokens: c.completionTokens,
      })),
      timeline: timeline.events.map((e) => ({
        seq: Number(e.seq),
        kind: e.kind,
        summary: e.summary,
      })),
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
