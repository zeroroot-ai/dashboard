/**
 * Mission Creation API Route
 *
 * POST /api/missions/create
 *
 * Creates a new mission from YAML configuration.
 * Validates, forwards to Gibson daemon, and returns mission ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { validateMissionYAML } from '@/src/lib/mission/validation';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import type { CreateMissionRequest, CreateMissionResponse } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

interface GibsonCreateMissionResponse {
  success: boolean;
  missionId?: string;
  error?: string;
}

// ============================================================================
// Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, 'missions:create', {
      maxRequests: 20,
      windowSeconds: 60,
      identifier: 'user' as const,
    });
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult) as NextResponse<CreateMissionResponse>;
    }

    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: CreateMissionRequest = await request.json();
    const { yaml, startImmediately, name } = body;

    if (!yaml || typeof yaml !== 'string') {
      return NextResponse.json(
        { success: false, error: 'YAML content is required' },
        { status: 400 }
      );
    }

    // Server-side validation — always enforced, cannot be skipped by clients
    const validationResult = validateMissionYAML(yaml);

    if (!validationResult.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors: validationResult.errors,
        },
        { status: 400 }
      );
    }

    // Extract user and tenant info
    const userId = session.user?.email || 'unknown';
    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: 'No tenant associated with session' },
        { status: 403 }
      );
    }

    // Forward to Gibson daemon
    const gibsonResponse = await createMissionInGibson({
      yaml,
      name: name || 'Unnamed Mission',
      startImmediately: startImmediately ?? true,
      userId,
      tenantId,
    });

    if (!gibsonResponse.success) {
      return safeErrorResponse(
        new Error(gibsonResponse.error || 'Unknown daemon error'),
        'Failed to launch mission — daemon unavailable',
        502,
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      missionId: gibsonResponse.missionId,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}

// ============================================================================
// Gibson Daemon Integration
// ============================================================================

interface CreateMissionParams {
  yaml: string;
  name: string;
  startImmediately: boolean;
  userId: string;
  tenantId: string;
}

async function createMissionInGibson(
  params: CreateMissionParams
): Promise<GibsonCreateMissionResponse> {
  // Parse YAML to extract mission metadata
  let missionName = params.name;
  let description = '';
  let target = '';
  try {
    const { parse } = await import('yaml');
    const parsed = parse(params.yaml);
    missionName = parsed?.name || params.name;
    description = typeof parsed?.description === 'string'
      ? parsed.description.trim().split('\n')[0]
      : '';
    target = parsed?.target?.seeds?.[0]?.replace(/^[^:]+:/, '') || '';
  } catch {}

  // Submit to Gibson daemon via gRPC RunMission with inline YAML
  let missionId = '';

  try {
    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({
      baseUrl: serverConfig.gibsonDaemonUrl,
    });
    const client = createClient(DaemonService, transport);

    // RunMission is server-streaming — read the first event to get the mission ID
    let gotFirstEvent = false;
    for await (const event of client.runMission({
      workflowYaml: params.yaml,
      memoryContinuity: 'isolated',
    })) {
      // First event should contain the mission ID
      if (!gotFirstEvent) {
        gotFirstEvent = true;
        missionId = event.missionId || '';
        // Don't block waiting for all events — the mission is running
        break;
      }
    }

    if (!missionId) {
      return { success: false, error: 'Daemon returned no mission ID' };
    }
  } catch (err: any) {
    console.error('[Missions] gRPC RunMission failed:', err?.message || err);
    // Return honest error — do not generate a fake missionId or write a
    // failed record to Neo4j.  The caller translates this into a 502.
    return { success: false, error: err?.message || 'Daemon unavailable' };
  }

  // Persist to Neo4j only after a successful daemon launch
  try {
    const { getNeo4jDriver } = await import('@/src/lib/neo4j-client');
    const driver = getNeo4jDriver();
    const session = driver.session({ database: 'neo4j' });
    try {
      await session.run(
        `MERGE (m:Mission {id: $id})
         SET m.name = $name,
             m.description = $description,
             m.target = $target,
             m.status = $status,
             m.startTime = datetime(),
             m.createdBy = $userId,
             m.tenant_id = $tenantId
         RETURN m.id`,
        {
          id: missionId,
          name: missionName,
          description,
          target,
          status: params.startImmediately ? 'running' : 'pending',
          userId: params.userId,
          tenantId: params.tenantId,
        }
      );
    } finally {
      await session.close();
    }
  } catch (err) {
    console.error('[Missions] Failed to save to Neo4j:', err);
  }

  return {
    success: true,
    missionId,
  };
}

// ============================================================================
// Draft Save Endpoint (PUT)
// ============================================================================

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
    }

    const body = await request.json() as { yaml?: string; name?: string; draftId?: string };
    if (!body.yaml || typeof body.yaml !== 'string' || body.yaml.trim() === '') {
      return NextResponse.json({ error: 'yaml (string) is required' }, { status: 400 });
    }

    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonAdminService } = await import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({ baseUrl: serverConfig.gibsonDaemonUrl });
    const client = createClient(DaemonAdminService, transport);

    const resp = await client.saveMissionDraft({
      tenantId,
      name: body.name ?? 'Untitled',
      yaml: body.yaml,
      draftId: body.draftId ?? '',
    });

    return NextResponse.json({ success: true, draftId: resp.draftId });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to save draft', 500);
  }
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
    }

    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonAdminService } = await import('@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({ baseUrl: serverConfig.gibsonDaemonUrl });
    const client = createClient(DaemonAdminService, transport);

    const resp = await client.listMissionDrafts({ tenantId });
    return NextResponse.json({ drafts: resp.drafts });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to list drafts', 500);
  }
}
