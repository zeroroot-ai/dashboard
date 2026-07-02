"use server";

/**
 * getLlmUsageAction, read-side Server Action for the /usage page.
 * Wraps the daemon's UsageService.ListUsage RPC so the dashboard
 * surfaces cost / token rollups grouped by user, team, agent, or
 * mission.
 *
 * Non-admin callers are narrowed server-side to themselves regardless
 * of the subjectFilter they pass.
 *
 * Spec: llm-user-attribution-governance (Requirement 2).
 */

import { getUsageClient } from "@/src/lib/gibson-client";
import { getServerSession } from "@/src/lib/auth";
import { UsageScope } from "@/src/gen/gibson/tenant/v1/usage_pb";

export type UsageRow = {
  subjectId: string;
  displayName: string;
  inputTokens: number;
  outputTokens: number;
  costUsdCents: number;
  traceCount: number;
};

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type UsageScopeInput = "user" | "team" | "agent" | "mission";

function scopeToProto(scope: UsageScopeInput): UsageScope {
  switch (scope) {
    case "user":
      return UsageScope.USER;
    case "team":
      return UsageScope.TEAM;
    case "agent":
      return UsageScope.AGENT;
    case "mission":
      return UsageScope.MISSION;
  }
}

interface GetLlmUsageRequest {
  scope: UsageScopeInput;
  /**
   * Unix seconds. Omit for "current month to date".
   */
  fromUnix?: number;
  toUnix?: number;
  /**
   * Optional subject-id filter (ignored for non-admin callers, they
   * are narrowed server-side to themselves).
   */
  subjectFilter?: string;
}

interface GetLlmUsageResponse {
  rows: UsageRow[];
  staleAsOfUnix: number;
}

export async function getLlmUsageAction(
  req: GetLlmUsageRequest,
): Promise<ActionResult<GetLlmUsageResponse>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    const client = await getUsageClient();
    const resp = await client.listUsage({
      scope: scopeToProto(req.scope),
      startTimeUnix: BigInt(req.fromUnix ?? monthStartUnix()),
      endTimeUnix: BigInt(req.toUnix ?? Math.floor(Date.now() / 1000)),
      subjectFilter: req.subjectFilter ?? "",
    });

    return {
      ok: true,
      data: {
        rows: resp.rows.map((r) => ({
          subjectId: r.subjectId,
          displayName: r.displayName,
          inputTokens: Number(r.inputTokens),
          outputTokens: Number(r.outputTokens),
          costUsdCents: Number(r.costUsdCents),
          traceCount: Number(r.traceCount),
        })),
        staleAsOfUnix: Number(resp.staleAsOfUnix),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function monthStartUnix(): number {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Math.floor(start.getTime() / 1000);
}
