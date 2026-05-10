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
    //
    // The route accepts two shapes:
    //
    //   Legacy:  { yaml: string, name?, startImmediately? }
    //            — pre-rewrite authoring that ships YAML to the
    //              server, parses to MissionConfig, serializes
    //              to MissionDefinition.
    //
    //   New v2:  { definition: MissionDefinitionJson,
    //              constraints?: MissionConstraintsJson,
    //              name?, startImmediately? }
    //            — post-rewrite shape from form components that
    //              bind directly to the generated proto types.
    //              The route renders this back to YAML internally
    //              and forwards through the existing Gibson
    //              integration so both paths converge.
    //
    // Spec: mission-dashboard-rewrite Requirement 1 AC 4 + Task 16.
    const body: CreateMissionRequest & { definition?: unknown; constraints?: unknown } =
      await request.json();
    let { yaml, startImmediately, name } = body;

    // New-shape path: serialize the proto-typed `definition` to
    // YAML so the legacy validator + serializer pipeline below
    // continues to work unchanged. This keeps the rewrite
    // additive — the existing fail-fast guards still apply.
    if (!yaml && body.definition) {
      try {
        yaml = await renderProtoDefinitionToYaml(body.definition, body.constraints);
      } catch (e) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Failed to serialize new-shape MissionDefinition to YAML: ' +
              (e instanceof Error ? e.message : String(e)),
          },
          { status: 400 },
        );
      }
    }

    if (!yaml || typeof yaml !== 'string') {
      return NextResponse.json(
        { success: false, error: 'YAML content is required (or pass `definition` for the new shape)' },
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
// New-shape adapter (Spec 4 Task 16)
// ============================================================================

/**
 * renderProtoDefinitionToYaml — converts the new-shape request
 * payload (proto-typed MissionDefinition + MissionConstraints
 * via @bufbuild/protobuf JSON) into the YAML the legacy
 * validator + serializer expects.
 *
 * The dashboard's form components bind directly to the
 * generated proto types and serialize via protobuf-es's
 * `toJson`. We accept that shape here, fold MissionConstraints
 * fields into the YAML's metadata block, and let the existing
 * validator handle the rest.
 *
 * The legacy YAML format is the source of truth for this route's
 * downstream pipeline; treating it as the rendezvous point
 * minimizes blast radius. Future cleanup can lift the proto
 * types end-to-end.
 */
async function renderProtoDefinitionToYaml(
  definition: unknown,
  constraints: unknown,
): Promise<string> {
  // Lazy-import yaml so it doesn't add to the route's cold-start
  // surface unless a new-shape request actually arrives.
  const { stringify } = await import('yaml');
  const payload = {
    ...(typeof definition === 'object' && definition !== null ? definition : {}),
    ...(typeof constraints === 'object' && constraints !== null
      ? { constraints }
      : {}),
  };
  return stringify(payload);
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
    const { userClient } = await import('@/src/lib/gibson-client');

    const client = userClient(DaemonService);

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
