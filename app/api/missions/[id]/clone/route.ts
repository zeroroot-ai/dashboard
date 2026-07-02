/**
 * Mission Clone API Route
 *
 * GET /api/missions/[id]/clone
 *
 * Returns CUE source text for an existing mission so the author can open it
 * in the CUE editor, adjust, and run a new mission. Closes dashboard#352.
 *
 * Flow:
 *   1. Resolve the mission run by id via ListMissions.
 *   2. If the run has no missionDefinitionId the mission was created via the
 *      programmatic path (no author-managed definition), return 410.
 *   3. Call GetMissionDefinition(missionDefinitionId) to get the full proto.
 *   4. Serialise to CUE and return { cueSource, name }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { listMissions, getMissionDefinition } from '@/src/lib/gibson-client';
import { definitionToCUE } from '@/src/lib/mission/cue-serializer';
import { logger } from '@/src/lib/logger';
import { ConnectError, Code } from '@connectrpc/connect';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const { id } = await params;

  // Resolve the mission run.
  const listResp = await listMissions(false, 1000, session.user?.id).catch((err) => {
    logger.error({ err, missionId: id }, 'clone: listMissions failed');
    return null;
  });
  const mission = listResp?.missions.find((m) => m.id === id);
  if (!mission) {
    return NextResponse.json(
      { success: false, error: 'Mission not found' },
      { status: 404 },
    );
  }

  const definitionId = mission.missionDefinitionId;
  if (!definitionId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'This mission was not created from a CUE definition and cannot be cloned. ' +
          'Open the CUE editor and author a new mission.',
      },
      { status: 410 },
    );
  }

  // Fetch the full definition proto.
  let defResp;
  try {
    defResp = await getMissionDefinition(definitionId, session.user?.id);
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      return NextResponse.json(
        { success: false, error: 'Mission definition no longer exists' },
        { status: 410 },
      );
    }
    logger.error({ err, definitionId }, 'clone: GetMissionDefinition failed');
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve mission definition' },
      { status: 500 },
    );
  }

  if (!defResp.definition) {
    return NextResponse.json(
      { success: false, error: 'Mission definition not found' },
      { status: 410 },
    );
  }

  const def = defResp.definition;
  const cueSource = definitionToCUE(def);

  return NextResponse.json({
    success: true,
    cueSource,
    name: def.name,
  });
}
