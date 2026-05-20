import { NextRequest, NextResponse } from 'next/server';
import { create } from '@bufbuild/protobuf';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient, runMission } from '@/src/lib/gibson-client';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import {
  MissionDefinitionSchema,
  MissionNodeSchema,
  AgentNodeConfigSchema,
  NodeType,
} from '@/src/gen/gibson/mission/v1/mission_definition_pb';
import { TaskSchema } from '@/src/gen/gibson/types/v1/types_pb';

/**
 * POST /api/missions/demo
 *
 * One-click demo path. Skips the YAML authoring flow entirely:
 *
 *   1. Build a minimal MissionDefinition proto in-process (single nmap-agent
 *      node targeting scanme.nmap.org — the Nmap project's public scan
 *      target, sanctioned for hands-off demos).
 *   2. Register the definition via daemon.CreateMissionDefinition.
 *   3. Create a mission instance via daemon.CreateMission.
 *   4. Dispatch via runMission (RunMission streaming RPC, first event then
 *      return — same pattern as /api/missions/[id]/start#239).
 *   5. Return the started mission's id so the client can navigate to the
 *      mission detail page.
 *
 * The dispatch creates a *new* mission record (RunMission has no
 * `mission_id` field by design — see #239 dispatch notes). Both records
 * land in the tenant's mission list; the response carries the *running*
 * one's id so the dashboard navigates to the live view.
 */

const DEMO_TARGET = 'scanme.nmap.org';
const DEMO_AGENT = 'nmap-agent';
const DEMO_MISSION_NAME = 'Demo: nmap scan against scanme.nmap.org';

function buildDemoMissionDefinition() {
  const scanNode = create(MissionNodeSchema, {
    id: 'scan',
    name: 'nmap scan',
    description: 'Run nmap against the demo target.',
    type: NodeType.AGENT,
    dependencies: [],
    metadata: {},
    config: {
      case: 'agentConfig',
      value: create(AgentNodeConfigSchema, {
        agentName: DEMO_AGENT,
        task: create(TaskSchema, {
          goal: `Run a default nmap scan against ${DEMO_TARGET} and report open ports + services.`,
        }),
      }),
    },
  });

  return create(MissionDefinitionSchema, {
    name: 'demo-nmap-recon',
    description:
      'One-click demo mission. Runs a single nmap-agent node against scanme.nmap.org.',
    version: '1.0.0',
    targetRef: DEMO_TARGET,
    nodes: { scan: scanNode },
    edges: [],
    entryPoints: ['scan'],
    exitPoints: ['scan'],
    metadata: { source: 'demo' },
  });
}

export async function POST(request: NextRequest) {
  try {
    // CSRF — zero-trust-hardening Req 11.5
    try {
      await requireCsrf(request);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }

    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPCs.

    const client = userClient(DaemonService);
    const definition = buildDemoMissionDefinition();

    // Step 1: register the mission definition.
    const defResp = await client.createMissionDefinition({ definition });
    const missionDefinitionId = defResp.missionDefinitionId;
    if (!missionDefinitionId) {
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Daemon did not return a mission definition ID',
          },
        },
        { status: 500 }
      );
    }

    // Step 2: create a mission instance referencing the definition.
    const createResp = await client.createMission({
      name: DEMO_MISSION_NAME,
      description: `One-click demo mission against ${DEMO_TARGET}.`,
      targetId: DEMO_TARGET,
      missionDefinitionId,
      variables: {},
      memoryContinuity: 'isolated',
    });
    if (!createResp.success || !createResp.mission?.id) {
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: createResp.message || 'Daemon rejected CreateMission',
          },
        },
        { status: 500 }
      );
    }

    // Step 3: dispatch via RunMission. This produces a *new* running mission
    // record; the placeholder created in step 2 stays as the registered
    // intent (same semantics as the Start route in #239 for pending
    // missions).
    const runResp = await runMission(
      missionDefinitionId,
      DEMO_TARGET,
      {},
      'isolated',
      session?.user?.id
    );

    const runningMissionId = runResp.missionId || createResp.mission.id;

    return NextResponse.json({
      success: true,
      message: 'Demo mission started',
      missionId: runningMissionId,
      target: DEMO_TARGET,
    });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
