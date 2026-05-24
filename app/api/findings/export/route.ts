/**
 * Findings Export API Route
 *
 * GET /api/findings/export[?format=csv|json]
 *
 * Delegates to TenantAdminService.ExportFindings — the daemon pages through
 * all findings for the tenant (server-side, same Cypher as GetFindings), assembles
 * the requested format, and returns bytes + filename. Routes through Envoy + ext-authz.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 11).
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  sarif: 'application/sarif+json; charset=utf-8',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'No tenant associated with session' } },
        { status: 403 },
      );
    }

    const format = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'json' && format !== 'sarif') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'format must be csv, json, or sarif' } },
        { status: 400 },
      );
    }

    const severity = request.nextUrl.searchParams.get('severity') ?? '';
    const missionId = request.nextUrl.searchParams.get('missionId') ?? '';
    const search = request.nextUrl.searchParams.get('search') ?? '';

    const resp = await userClient(TenantService).exportFindings({
      tenantId,
      format,
      findingIds: [],
      filters: {
        severity: severity ? [severity] : [],
        type: [],
        missionId,
        search,
      },
      includeRemediation: false,
      includeEvidence: false,
    });

    const contentType = CONTENT_TYPES[resp.format] ?? CONTENT_TYPES[format] ?? 'application/octet-stream';
    const filename = resp.filename || `findings-${tenantId}-${new Date().toISOString().slice(0, 10)}.${format}`;

    return new NextResponse(Buffer.from(resp.data), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.PermissionDenied || error.code === Code.Unauthenticated) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: error.message } },
          { status: 403 },
        );
      }
      if (error.code === Code.ResourceExhausted) {
        return NextResponse.json(
          { error: { code: 'TOO_LARGE', message: error.message } },
          { status: 413 },
        );
      }
    }
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
