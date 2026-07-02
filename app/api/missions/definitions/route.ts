/**
 * GET /api/missions/definitions
 *
 * Lists all installed mission definitions via
 * DaemonService.ListMissionDefinitions. Returns a summary shape that
 * is JSON-safe (bigint unix timestamps converted to numbers).
 *
 * Closes #319.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/src/lib/auth";
import { listMissionDefinitions } from "@/src/lib/gibson-client";
import { daemonErrorResponse } from "@/src/lib/api-errors";
import { logger } from "@/src/lib/logger";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  try {
    const resp = await listMissionDefinitions(session.user?.id);

    const definitions = resp.missions.map((d) => ({
      name: d.name,
      version: d.version,
      description: d.description,
      nodeCount: d.nodeCount,
      installedAt: d.installedAt === BigInt(0) ? null : Number(d.installedAt),
      updatedAt: d.updatedAt === BigInt(0) ? null : Number(d.updatedAt),
    }));

    return NextResponse.json({ definitions });
  } catch (err) {
    logger.error({ err }, "ListMissionDefinitions RPC failed");
    return daemonErrorResponse(err, { headers: request.headers });
  }
}
