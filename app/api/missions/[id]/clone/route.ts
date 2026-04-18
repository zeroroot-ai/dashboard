/**
 * Mission Clone API Route
 *
 * GET /api/missions/[id]/clone
 *
 * Returns mission YAML for cloning (without execution state).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { listMissions, serializeMission } from '@/src/lib/gibson-client';

// ============================================================================
// Types
// ============================================================================

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CloneMissionResponse {
  success: boolean;
  yaml?: string;
  name?: string;
  error?: string;
}

// ============================================================================
// Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get mission ID
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Mission ID is required' },
        { status: 400 }
      );
    }

    // Fetch missions from Gibson daemon via gRPC
    const response = await listMissions(false, 1000, session?.user?.id);

    // Find the mission by ID
    const mission = response.missions.find(m => m.id === id);

    if (!mission) {
      return NextResponse.json(
        { success: false, error: 'Mission not found' },
        { status: 404 }
      );
    }

    const serialized = serializeMission(mission);

    // Cloning a mission by fetching its YAML from the daemon is no longer
    // supported: under spec mission-api-only-cleanup YAML is an authoring-side
    // convenience only, and the daemon stores a structured MissionDefinition.
    // Future work: fetch the definition via GetMissionDefinition and render
    // it back to YAML in the editor for cloning.
    return NextResponse.json(
      {
        success: false,
        error:
          'Mission cloning is temporarily unavailable. The daemon now stores structured mission definitions; YAML reconstruction from a registered definition is planned in a follow-up.',
        name: serialized.name,
      },
      { status: 501 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}

