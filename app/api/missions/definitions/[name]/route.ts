/**
 * GET /api/missions/definitions/[name]
 *
 * Fetches a single mission definition by name via
 * DaemonService.GetMissionDefinition (M5 RPC — ships full structured proto).
 * Returns the definition as JSON; the client renders it via
 * MissionDefinitionDetail. M6 — mission-author-experience.
 *
 * Closes #187.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/src/lib/auth";
import { getMissionDefinition } from "@/src/lib/gibson-client";
import { toJson } from "@bufbuild/protobuf";
import { MissionDefinitionSchema } from "@/src/gen/gibson/mission/v1/mission_definition_pb";
import { logger } from "@/src/lib/logger";

interface RouteParams {
  params: Promise<{ name: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { name } = await params;

  try {
    const resp = await getMissionDefinition(name, session.user?.id);
    if (!resp.definition) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Mission definition not found" } },
        { status: 404 },
      );
    }
    // Serialize via protobuf JSON so bigint / Timestamp / Duration fields
    // are handled correctly (bigint → string, Timestamp → RFC3339, etc.).
    const json = toJson(MissionDefinitionSchema, resp.definition);
    return NextResponse.json(json);
  } catch (err) {
    logger.error({ err, name }, "GetMissionDefinition RPC failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to fetch mission definition" } },
      { status: 500 },
    );
  }
}
