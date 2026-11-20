// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { toIncidentReport } from '@/src/lib/incidents/incident-report';
import { IncidentReportService } from '@/src/gen/gibson/tenant/v1/incident_report_pb';

/**
 * GET /api/incidents/[key]/report
 *
 * The report of one incident: its alerts, what it reaches, each response action
 * with its grant, the cause, the fix and the proof of the fix, each line with
 * its Timeline position (IncidentReportService.GetIncidentReport, gibson#1480).
 * The daemon resolves the tenant from the identity of the caller.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }
    const r = await userClient(IncidentReportService).getIncidentReport({
      incidentKey: decodeURIComponent(key),
    });
    return NextResponse.json(toIncidentReport(r));
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
