// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server actions for the run chain of a mission and the rewind action
 * (dashboard#227, ADR-0170).
 *
 * A rewind starts a new run. The new run records the first run and the
 * checkpoint as its parent, so the runs of a mission form a chain. These
 * actions wrap the DaemonService RPCs GetMissionHistory,
 * GetMissionCheckpoints and RewindMission. They go through Envoy via
 * userClient, never a direct daemon channel. Whoever may run the mission
 * may rewind it: RewindMission carries the same relation as RunMission.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { ConnectError } from "@connectrpc/connect";

import { authzDenial } from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { logger } from "@/src/lib/logger";

/** One run of a mission, as the run chain shows it. */
export interface MissionRunView {
  missionId: string;
  runNumber: number;
  status: string;
  /** Unix seconds; 0 when unknown. */
  createdAt: number;
  /** The run that this run was rewound from. Empty for a first run. */
  parentMissionId: string;
  /** The checkpoint of the parent run at which this run started. */
  parentCheckpointId: string;
}

/** One checkpoint of a run: the end of one node. */
export interface CheckpointView {
  checkpointId: string;
  nodeId: string;
  /** ISO time at which the node ended; empty when unknown. */
  endedAt: string;
  /** True when a sandbox snapshot exists for this checkpoint. */
  hasSnapshot: boolean;
}

export type RunActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: "permission_denied" | "invalid" | "rpc_failed" };

/** The daemon allows a page of up to 1000; the chain reads every page. */
const HISTORY_PAGE_SIZE = 200;

function mapErr(err: unknown, op: string): {
  ok: false;
  error: string;
  code: "permission_denied" | "rpc_failed";
} {
  if (authzDenial(err)) {
    return { ok: false, error: "Permission denied", code: "permission_denied" };
  }
  if (err instanceof ConnectError) {
    logger.warn({ op, rpcCode: err.code, rawMessage: err.rawMessage }, "run action RPC failed");
    return { ok: false, error: err.rawMessage || "The request failed", code: "rpc_failed" };
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ op, err: { message: msg } }, "run action unexpected error");
  return { ok: false, error: msg, code: "rpc_failed" };
}

/** Every run of the mission with this name, oldest first. */
export async function listMissionRunsAction(
  missionName: string,
): Promise<RunActionResult<MissionRunView[]>> {
  if (!missionName) {
    return { ok: false, error: "mission name is required", code: "invalid" };
  }
  try {
    const client = userClient(DaemonService);
    const runs: MissionRunView[] = [];
    let pageToken = "";
    do {
      const resp = await client.getMissionHistory({
        name: missionName,
        pageSize: HISTORY_PAGE_SIZE,
        pageToken,
      });
      for (const r of resp.runs) {
        runs.push({
          missionId: r.missionId,
          runNumber: r.runNumber,
          status: r.status,
          createdAt: Number(r.createdAt),
          parentMissionId: r.parentMissionId,
          parentCheckpointId: r.parentCheckpointId,
        });
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    runs.sort((a, b) => a.runNumber - b.runNumber);
    return { ok: true, data: runs };
  } catch (err) {
    return mapErr(err, "getMissionHistory");
  }
}

/** The checkpoints of one run: one for each node end. */
export async function getMissionCheckpointsAction(
  missionId: string,
): Promise<RunActionResult<CheckpointView[]>> {
  if (!missionId) {
    return { ok: false, error: "mission id is required", code: "invalid" };
  }
  try {
    const client = userClient(DaemonService);
    const resp = await client.getMissionCheckpoints({ missionId });
    return {
      ok: true,
      data: resp.checkpoints.map((c) => ({
        checkpointId: c.checkpointId,
        nodeId: c.nodeId,
        endedAt: c.endedAt
          ? new Date(
              Number(c.endedAt.seconds) * 1000 + Math.floor(c.endedAt.nanos / 1e6),
            ).toISOString()
          : "",
        hasSnapshot: Boolean(c.snapshotId),
      })),
    };
  } catch (err) {
    return mapErr(err, "getMissionCheckpoints");
  }
}

/**
 * Start a new run from a checkpoint of a run. It deletes nothing.
 *
 * `instruction` replaces the instruction of the rewound node only. An empty
 * value keeps the instruction of the definition. The idempotency key comes
 * from the dialog, so a retry of the same click starts no second run.
 */
export async function rewindMissionAction(input: {
  missionId: string;
  checkpointId: string;
  instruction: string;
  idempotencyKey: string;
}): Promise<RunActionResult<{ missionId: string }>> {
  if (!input?.missionId || !input.checkpointId) {
    return { ok: false, error: "mission id and checkpoint id are required", code: "invalid" };
  }
  try {
    const client = userClient(DaemonService);
    const instruction = input.instruction.trim();
    const resp = await client.rewindMission({
      missionId: input.missionId,
      checkpointId: input.checkpointId,
      ...(instruction ? { instruction } : {}),
      idempotencyKey: input.idempotencyKey || randomUUID(),
    });
    return { ok: true, data: { missionId: resp.missionId } };
  } catch (err) {
    return mapErr(err, "rewindMission");
  }
}
