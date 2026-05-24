/**
 * Mission Creation API Route
 *
 * POST /api/missions/create
 *
 * Creates a new mission from CUE source authored in the MissionCUEEditor.
 *
 * The daemon's CreateMissionDefinition RPC accepts CUE source directly via
 * the `cue_source` field (platform-sdk v0.7.0). The daemon compiles and
 * validates the CUE against the embedded schema before persisting. No
 * client-side parsing of mission content is needed — the daemon is the
 * authoritative parser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { ConnectError, Code } from '@connectrpc/connect';
import { daemonErrorResponse } from '@/src/lib/api-errors';
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
    // CSRF — zero-trust-hardening Req 11.5. The mission-create flow is
    // user-acting (browser session), so the proxy-seeded csrf-token cookie
    // applies. Service-acting callers do not invoke this route.
    try {
      await requireCsrf(request);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }

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

    // Parse request body — accept `cueSource` (new) or legacy `yaml` field
    const body: CreateMissionRequest = await request.json();
    const bodyAny = body as unknown as Record<string, unknown>;
    const cueSource = (bodyAny.cueSource as string | undefined) ?? body.yaml;
    const { startImmediately, name } = body;

    if (!cueSource || typeof cueSource !== 'string') {
      return NextResponse.json(
        { success: false, error: 'CUE source is required' },
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
      cueSource,
      name: name || 'Unnamed Mission',
      startImmediately: startImmediately ?? true,
      userId,
      tenantId,
    });

    if (!gibsonResponse.success) {
      return daemonErrorResponse(
        new ConnectError(
          gibsonResponse.error || 'Unknown daemon error',
          Code.Unavailable,
        ),
        { headers: request.headers, route: 'missions/create' },
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      missionId: gibsonResponse.missionId,
    });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}

// ============================================================================
// Gibson Daemon Integration
// ============================================================================

interface CreateMissionParams {
  cueSource: string;
  name: string;
  startImmediately: boolean;
  userId: string;
  tenantId: string;
}

async function createMissionInGibson(
  params: CreateMissionParams
): Promise<GibsonCreateMissionResponse> {
  try {
    // Route all daemon traffic through Envoy + SPIFFE mTLS via `userClient`.
    // Direct channels to :50051 are rejected by the prebuild guard.
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
    const { DaemonAdminService } = await import(
      '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb'
    );
    const { userClient } = await import('@/src/lib/gibson-client');

    const client = userClient(DaemonService);
    const adminClient = userClient(DaemonAdminService);

    // Step 1: Register the mission definition via CUE source (platform-sdk
    // v0.7.0). The daemon compiles and validates the CUE against the embedded
    // mission schema before persisting the resulting MissionDefinition proto.
    const defResp = await adminClient.createMissionDefinition({
      source: { case: 'cueSource', value: params.cueSource },
    });
    const missionDefinitionId = defResp.missionDefinitionId;
    if (!missionDefinitionId) {
      return {
        success: false,
        error: 'Daemon did not return a mission definition ID',
      };
    }

    // Step 2: Create the mission referencing the registered definition.
    const createResp = await client.createMission({
      name: params.name,
      description: '',
      targetId: '',
      missionDefinitionId,
      variables: {},
      memoryContinuity: 'isolated',
      sourceYaml: params.cueSource,
    });

    if (!createResp.success || !createResp.mission?.id) {
      return {
        success: false,
        error: createResp.message || 'Daemon rejected CreateMission',
      };
    }

    return { success: true, missionId: createResp.mission.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Missions] gRPC mission-create failed:', message);
    return { success: false, error: message || 'Daemon unavailable' };
  }
}

// ============================================================================
// Draft Save Endpoint (PUT)
// ============================================================================

// SaveMissionDraft is DEFERRED per admin-services-completion spec (design.md
// disposition table). The daemon TenantAdminService stub returns Unimplemented.
export async function PUT(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'Mission draft persistence is not yet wired to the daemon; ' +
          'see SaveMissionDraft in spec headline-feature-completion.',
      },
    },
    { status: 501 },
  );
}

// ListMissionDrafts is DEFERRED per admin-services-completion spec (design.md
// disposition table). Returns empty list until mission-yaml-editor spec ships.
export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ drafts: [] });
}
