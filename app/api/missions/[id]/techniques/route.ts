// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { MissionTechnique, MissionTechniques } from '@/src/types/calibration';

/**
 * GET /api/missions/:id/techniques — the techniques one mission used, each
 * in the scope the mission used it in (dashboard#192, gibson#619,
 * ADR-0129 §3).
 *
 * A technique the mission used is a technique that a hypothesis of the
 * mission names. The daemon projects each hypothesis into the tenant graph
 * as a Hypothesis node with its mission_id, its scope and its technique, so
 * the route reads the Hypothesis nodes through GraphService.GetTenantGraph
 * and keeps the ones of this mission. Read-only; the daemon resolves the
 * tenant server-side (GraphService over Envoy + ext-authz).
 */

/** The largest node count one GetTenantGraph read returns (the daemon caps it there too). */
const HYPOTHESIS_LIMIT = 5000;

const MAX_MISSION_ID = 1024;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const { id: missionId } = await params;
    if (!missionId || missionId.length > MAX_MISSION_ID) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'A mission id is required' } },
        { status: 400 },
      );
    }

    const resp = await userClient(GraphService).getTenantGraph({
      includeLabels: ['Hypothesis'],
      limit: HYPOTHESIS_LIMIT,
    });

    const seen = new Set<string>();
    const techniques: MissionTechnique[] = [];
    for (const node of resp.nodes) {
      if (!node.labels.includes('Hypothesis')) continue;
      if (node.properties['mission_id'] !== missionId) continue;
      const technique = node.properties['technique'] ?? '';
      const scopeId = node.properties['scope'] ?? '';
      if (technique === '') continue;
      const key = `${technique}\u0000${scopeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      techniques.push({ technique, scopeId });
    }
    techniques.sort(
      (a, b) => a.technique.localeCompare(b.technique) || a.scopeId.localeCompare(b.scopeId),
    );

    const body: MissionTechniques = { techniques, truncated: resp.truncated };
    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
