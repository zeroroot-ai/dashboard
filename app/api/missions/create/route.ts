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
    const { createClient } = await import('@connectrpc/connect');
    const { createGrpcTransport } = await import('@connectrpc/connect-node');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
    const { serverConfig } = await import('@/src/lib/config');

    const transport = createGrpcTransport({
      baseUrl: serverConfig.gibsonDaemonUrl,
    });
    const client = createClient(DaemonService, transport);

    // Step 1: Register the mission definition.
    const defResp = await client.createMissionDefinition({ definition });
    const missionDefinitionId = defResp.missionDefinitionId;
    if (!missionDefinitionId) {
      return {
        success: false,
        error: 'Daemon did not return a mission definition ID',
      };
    }

    // Step 2: Create the mission referencing the registered definition.
    const createResp = await client.createMission({
      name: metadata.name,
      description: metadata.description,
      targetId,
      missionDefinitionId,
      variables: {},
      memoryContinuity: 'isolated',
    });

    if (!createResp.success || !createResp.mission?.id) {
      return {
        success: false,
        error: createResp.message || 'Daemon rejected CreateMission',
      };
    }

    const missionId = createResp.mission.id;

    // Persist a Neo4j mirror record only after a successful daemon launch.
    // The source YAML rides along on the node so the clone API can read it
    // back without needing a daemon GetMissionDefinition RPC. The daemon
    // remains the source-of-truth for execution state; Neo4j is only the
    // authoring-format cache. Spec: mission-api-only-cleanup follow-up.
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
               m.tenant_id = $tenantId,
               m.source_yaml = $sourceYaml
           RETURN m.id`,
          {
            id: missionId,
            name: metadata.name,
            description: metadata.description,
            target: targetId,
            status: params.startImmediately ? 'running' : 'pending',
            userId: params.userId,
            tenantId: params.tenantId,
            sourceYaml: params.yaml,
          }
        );
      } finally {
        await session.close();
      }
    } catch (err) {
      console.error('[Missions] Failed to save to Neo4j:', err);
    }

    return { success: true, missionId };
  } catch (err: any) {
    console.error('[Missions] gRPC mission-create failed:', err?.message || err);
    return { success: false, error: err?.message || 'Daemon unavailable' };
  }
}

// ============================================================================
// Draft Save Endpoint (PUT)
// ============================================================================

// SaveMissionDraft is DEFERRED per admin-services-completion spec (design.md
// disposition table). The daemon TenantAdminService stub returns Unimplemented.
export async function PUT(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Mission draft saving coming soon' },
    { status: 501 }
  );
}

// ListMissionDrafts is DEFERRED per admin-services-completion spec (design.md
// disposition table). Returns empty list until mission-yaml-editor spec ships.
export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ drafts: [] });
}
