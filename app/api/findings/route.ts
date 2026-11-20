// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { principalViewFromRef } from '@/src/lib/gibson-client/principal';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import { walkItems } from '@/src/lib/gibson-client/paging';
import { safeHttpUrl } from '@/src/lib/findings/open-findings';
import { parseFindingPriority, parseFindingStatus } from '@/src/lib/findings/status';
import type { Finding, PaginatedResponse } from '@/src/types';

/**
 * GET /api/findings
 *
 * Retrieve findings from the knowledge graph with filtering and pagination.
 * Calls GraphService.GetFindings, routes through Envoy + ext-authz.
 *
 * The status, the priority with its rule and the confidence come from the
 * `properties` of GetFindings (gibson#1498). The place and the merge request
 * come from WorldService.ListOpenFindings, which lists the findings that are
 * not verified. A verified finding has no place and no merge request here.
 * The route sets no constant for a field of a finding.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 11).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const searchParams = request.nextUrl.searchParams;
    const severity = searchParams.get('severity') ?? '';
    const category = searchParams.get('category') ?? '';
    const missionId = searchParams.get('missionId') ?? '';
    const search = searchParams.get('search') ?? '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    // The page token of the daemon (ADR-0028 rule 3, sdk#232). The client
    // sends back the `nextCursor` of the previous page; an empty value asks
    // for the first page.
    const pageToken = searchParams.get('cursor') ?? '';

    const [resp, open] = await Promise.all([
      userClient(GraphService).getFindings({
        severityFilter: severity,
        categoryFilter: category,
        missionId,
        search,
        pageSize: limit,
        pageToken,
      }),
      walkItems('world.openFindings', async (pageSize, token) => {
        const r = await userClient(WorldService).listOpenFindings({ pageSize, pageToken: token });
        return { items: r.findings, nextPageToken: r.nextPageToken };
      }),
    ]);
    const openById = new Map(open.map((o) => [o.id, o]));

    const findings = resp.findings.map((f) => {
      const labels = f.labels;
      const place = openById.get(f.id);
      const confidence = Number(f.properties['confidence']);
      return {
        id: f.id,
        missionId: f.missionId || '',
        type: f.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
        title: f.name || 'Unknown',
        description: f.description || '',
        severity: (f.severity || 'info') as Finding['severity'],
        ...(place ? { affectedAssets: place.places.map((p) => p.label || p.key) } : {}),
        discoveredAt: f.createdAt ? new Date(Number(f.createdAt.seconds) * 1000) : new Date(),
        taxonomy: {},
        status: parseFindingStatus(f.properties['status']),
        priority: parseFindingPriority(f.properties['priority']),
        priorityRule: f.properties['priority_rule'] || undefined,
        confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : undefined,
        mergeRequestUrl: place ? safeHttpUrl(place.mergeRequestUrl) || undefined : undefined,
        source: labels.includes('Vulnerability') ? 'vulnerability-scan' : 'agent',
        category: f.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
        missionName: f.properties['missionName'] || undefined,
        cve: f.properties['cve'] || undefined,
        submittedBy: principalViewFromRef(f.properties['submitted_by']),
        enrolledBy: f.properties['enrolled_by'] || undefined,
        createdAt: f.createdAt ? new Date(Number(f.createdAt.seconds) * 1000) : new Date(),
        updatedAt: new Date(),
      };
    });

    const total = Number(resp.total);
    const response: PaginatedResponse<Finding> = {
      data: findings as Finding[],
      total,
      limit,
      ...(resp.nextPageToken ? { nextCursor: resp.nextPageToken } : {}),
      hasMore: resp.nextPageToken !== '',
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.PermissionDenied || error.code === Code.Unauthenticated) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: error.message } },
          { status: 403 }
        );
      }
    }
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
