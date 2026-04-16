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

    if (!serialized.workflowYaml) {
      return NextResponse.json(
        { success: false, error: 'Mission does not have workflow YAML' },
        { status: 404 }
      );
    }

    // Strip execution state from YAML
    const cleanedYaml = stripExecutionState(serialized.workflowYaml);

    return NextResponse.json({
      success: true,
      yaml: cleanedYaml,
      name: serialized.name,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}

// ============================================================================
// YAML Cleaning
// ============================================================================

/**
 * Strip execution-related fields from mission YAML
 */
function stripExecutionState(yaml: string): string {
  // Remove execution-related fields
  const fieldsToRemove = [
    /^status:.*$/gm,
    /^startedAt:.*$/gm,
    /^completedAt:.*$/gm,
    /^executionId:.*$/gm,
    /^findings:[\s\S]*?(?=\n[a-z]|$)/gm,
    /^results:[\s\S]*?(?=\n[a-z]|$)/gm,
    /^metrics:[\s\S]*?(?=\n[a-z]|$)/gm,
    /^logs:[\s\S]*?(?=\n[a-z]|$)/gm,
  ];

  let cleanedYaml = yaml;
  for (const pattern of fieldsToRemove) {
    cleanedYaml = cleanedYaml.replace(pattern, '');
  }

  // Remove empty lines created by removal
  cleanedYaml = cleanedYaml.replace(/\n{3,}/g, '\n\n');

  return cleanedYaml.trim();
}
