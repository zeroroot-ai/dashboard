/**
 * Mission Creation API Route
 *
 * POST /api/missions/create
 *
 * Creates a new mission from an authored YAML document.
 *
 * The YAML is a *client-side authoring format only* — it is parsed in this
 * route into a structured `MissionDefinition` proto, registered with the
 * daemon via `CreateMissionDefinition`, and then the returned definition ID
 * is used in a second call to `CreateMission`. No YAML ever reaches the
 * daemon.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { validateMissionYAML } from '@/src/lib/mission/validation';
import { yamlToState } from '@/src/lib/mission/parser';
import { serializeToMissionDefinition } from '@/src/lib/mission/mission-serializer';
import {
  DEFAULT_METADATA,
  DEFAULT_SCOPE,
  DEFAULT_MISSION,
  type MissionMetadata,
  type ScopeConfig,
  type MissionConfig,
} from '@/src/types/mission-creation';
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
  yaml: string;
  name: string;
  startImmediately: boolean;
  userId: string;
  tenantId: string;
}

async function createMissionInGibson(
  params: CreateMissionParams
): Promise<GibsonCreateMissionResponse> {
  // Parse YAML client-side into the authored state, then serialize to a
  // MissionDefinition proto. No YAML crosses the wire to the daemon.
  const parsed = yamlToState(params.yaml);
  if (!parsed.success || !parsed.data) {
    return {
      success: false,
      error: parsed.error?.message || 'Failed to parse mission YAML',
    };
  }

  const metadata: MissionMetadata = {
    ...DEFAULT_METADATA,
    ...(parsed.data.metadata ?? {}),
    name: parsed.data.metadata?.name || params.name,
  };
  const scope: ScopeConfig = {
    ...DEFAULT_SCOPE,
    ...(parsed.data.scope ?? {}),
  };
  const mission: MissionConfig = {
    ...DEFAULT_MISSION,
    ...(parsed.data.mission ?? {}),
  };

  const definition = serializeToMissionDefinition({ metadata, scope, mission });

  // Derive a target reference from the first scope seed for the
  // CreateMission call. The daemon treats target_id as a reference — in
  // this transitional phase the dashboard sends the seed value and the
  // daemon resolves it against its target registry.
  const targetId = scope.seeds[0]?.value ?? '';

  try {
    // Spec headline-feature-completion R11 + dashboard-admin-via-envoy:
    // route the daemon RPC through Envoy via the user-acting `userClient`
    // factory rather than building a direct grpc-transport off the
    // legacy `serverConfig.gibsonDaemonUrl`. The Envoy edge enforces
    // jwt_authn + ext_authz + SPIFFE mTLS upstream of the daemon; a
    // direct channel from this route bypasses every one of those checks.
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
    const { DaemonAdminService } = await import(
      '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb'
    );
    const { MissionDefinitionSchema } = await import(
      '@/src/gen/gibson/mission/v1/mission_definition_pb'
    );
    const { toBinary } = await import('@bufbuild/protobuf');
    const { userClient } = await import('@/src/lib/gibson-client');

    const client = userClient(DaemonService);
    // DaemonAdminService is the platform-sdk-published admin/writer surface
    // (parent PRD zero-day-ai/.github#101). CreateMissionDefinition moved
    // off the member-facing DaemonService; the member RPCs (CreateMission,
    // RunMission, etc.) stay on DaemonService. The admin request type carries
    // the structured MissionDefinition as `definition_serialized: bytes` (the
    // OSS gibson.mission.v1.MissionDefinition encoded with proto2 wire format)
    // — wire-equivalent to the old `definition: MissionDefinition` slot, but
    // it keeps platform-sdk free of the 600-line vendored mission proto.
    const adminClient = userClient(DaemonAdminService);
    const definitionSerialized = toBinary(MissionDefinitionSchema, definition);

    // Step 1: Register the mission definition (admin-tier).
    const defResp = await adminClient.createMissionDefinition({
      definitionSerialized,
    });
    const missionDefinitionId = defResp.missionDefinitionId;
    if (!missionDefinitionId) {
      return {
        success: false,
        error: 'Daemon did not return a mission definition ID',
      };
    }

    // Step 2: Create the mission referencing the registered definition.
    // Pass source_yaml so the daemon can store it for the clone workflow
    // (GetMissionSourceYAML). The daemon also does the Neo4j MERGE server-side
    // after this call succeeds (spec: dashboard-neo4j-crud-removal Phase 2).
    const createResp = await client.createMission({
      name: metadata.name,
      description: metadata.description,
      targetId,
      missionDefinitionId,
      variables: {},
      memoryContinuity: 'isolated',
      sourceYaml: params.yaml,
    });

    if (!createResp.success || !createResp.mission?.id) {
      return {
        success: false,
        error: createResp.message || 'Daemon rejected CreateMission',
      };
    }

    const missionId = createResp.mission.id;

    return { success: true, missionId };
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
