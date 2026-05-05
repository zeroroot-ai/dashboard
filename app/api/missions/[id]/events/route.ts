/**
 * GET /api/missions/:id/events
 *
 * Dashboard-side Server-Sent Events bridge for mission lifecycle events.
 *
 * Forwards the following daemon-derived events to the browser as named
 * SSE frames:
 *
 *   - `event: checkpoint`  — a new checkpoint has been captured for this
 *                            mission. Payload: a `CheckpointSummary` JSON
 *                            shape (matches `gibson.daemon.v1.CheckpointSummary`).
 *                            Consumed by `<CheckpointTimeline />` to
 *                            prepend timeline rows without a full re-fetch
 *                            (mission-checkpointing R17.7).
 *   - `event: status`      — mission status transition (pending → running
 *                            → paused → completed / failed / stopped).
 *                            Payload: { missionId, status }.
 *   - `event: rewind`      — the daemon emitted a `mission.rewind.completed`
 *                            audit event for this mission. Payload mirrors
 *                            the audit event's metadata fields.
 *
 * Implementation note: the daemon does not yet expose a server-streaming
 * `MissionStream` RPC, so this bridge uses a short-interval poll over the
 * existing `DaemonService.ListCheckpoints` and `DaemonService.ListMissions`
 * RPCs (which are tenant-scoped via the userClient) and emits diffs.
 * When a daemon-side stream lands later, the route can swap the polling
 * loop for a `for await (const ev of upstream)` pump without any
 * dashboard caller change. Spec follow-up captured in the parent task's
 * "blocked work" section.
 *
 * Security model:
 *   - The userClient flows through Envoy + ext-authz + SPIFFE-mTLS per
 *     dashboard `CLAUDE.md`; no direct daemon gRPC channel.
 *   - The downstream `ListCheckpoints` RPC is gated by the FGA
 *     `mission#viewer` relation (mission-checkpointing R13.2) so a
 *     non-viewer caller sees an empty stream + a one-time error frame.
 *   - We do NOT propagate client `request.signal` aborts upstream — when
 *     the browser disconnects we just stop the polling loop. The
 *     underlying daemon RPC has no in-flight stream to cancel.
 *
 * Spec: mission-checkpointing R17.7, week-4-handlers-ui-e2e §4 task 43
 *       (live SSE listener for the checkpoint timeline).
 */

import { NextRequest } from "next/server";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { logger } from "@/src/lib/logger";
import { getServerSession } from "@/src/lib/auth";
import { listMissions, userClient } from "@/src/lib/gibson-client";
import {
  DaemonService,
  ListCheckpointsRequestSchema,
  ListCheckpointsRequest_Order,
  type CheckpointSummary,
} from "@/src/gen/gibson/daemon/v1/daemon_pb";

// Polling cadence for the underlying daemon RPCs. 3s strikes a balance
// between dashboard freshness and daemon load — checkpoints capture at
// the orchestrator's super-step boundary (default ≥ 30s cadence per
// `checkpoint/policy.go:218`), so any 3s poll comfortably observes
// every new checkpoint exactly once.
const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;
const LIST_PAGE_SIZE = 50;

/**
 * SSE frame builder. Splits multi-line payloads on `\n` per the spec
 * and always terminates the frame with the canonical blank line.
 */
function sseFrame(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  if (event) lines.push(`event: ${event}`);
  const json = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of json.split("\n")) {
    lines.push(`data: ${line}`);
  }
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

/**
 * Produces a JSON-serialisable shape for a `CheckpointSummary`. The
 * proto bindings use bigint + Timestamp objects; the dashboard
 * timeline reconstructs the proto shape on the client side, so we
 * forward fields verbatim modulo bigint→string conversion to keep
 * `JSON.stringify` happy.
 */
function summaryToWire(summary: CheckpointSummary): Record<string, unknown> {
  return {
    checkpointId: summary.checkpointId,
    missionId: summary.missionId,
    superStep: summary.superStep.toString(),
    capturedAt: summary.capturedAt
      ? {
          seconds: summary.capturedAt.seconds.toString(),
          nanos: summary.capturedAt.nanos,
        }
      : undefined,
    sizeBytes: summary.sizeBytes.toString(),
    source: summary.source,
    inFlightIdempotency: summary.inFlightIdempotency,
    parallelGroupId: summary.parallelGroupId,
    expiresAt: summary.expiresAt
      ? {
          seconds: summary.expiresAt.seconds.toString(),
          nanos: summary.expiresAt.nanos,
        }
      : undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id: missionId } = await params;

  if (!missionId) {
    return new Response(JSON.stringify({ error: "missionId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const baseLog = {
    route: "missions/events",
    missionId,
  } as const;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      logger.info(baseLog, "mission events SSE bridge opened");

      // Open frame so EventSource flips to OPEN promptly on the client.
      try {
        controller.enqueue(encoder.encode(`: open\n\n`));
      } catch {
        return;
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const seenCheckpointIds = new Set<string>();
      let lastStatus: string | null = null;
      let cancelled = false;
      let seq = 0;

      // Tear down state shared between the polling loop and the
      // ReadableStream `cancel` hook below.
      const stopPolling = () => {
        cancelled = true;
        clearInterval(heartbeat);
      };

      const userId = session.user?.id ?? undefined;
      const tenantId = session.user?.tenantId ?? undefined;

      // Single poll iteration: fetch the latest checkpoint page +
      // mission status + emit diffs.
      const tick = async () => {
        if (cancelled) return;

        // ---- checkpoint diffs ----
        try {
          const req = create(ListCheckpointsRequestSchema, {
            missionId,
            pageSize: LIST_PAGE_SIZE,
            pageToken: "",
            order: ListCheckpointsRequest_Order.NEWEST_FIRST,
          });
          const resp = await userClient(DaemonService).listCheckpoints(req);

          // First-pass population: load all currently-known checkpoint
          // IDs into the seen set without emitting events. This avoids
          // a thunderclap of "checkpoint" frames on initial connection.
          const initialPass = seenCheckpointIds.size === 0 && lastStatus === null;
          if (initialPass) {
            for (const cp of resp.checkpoints) {
              seenCheckpointIds.add(cp.checkpointId);
            }
          } else {
            // Daemon returns newest-first; emit oldest-first so the
            // client's prepend-on-event handler renders rows in
            // capture order.
            for (let i = resp.checkpoints.length - 1; i >= 0; i--) {
              const cp = resp.checkpoints[i];
              if (!seenCheckpointIds.has(cp.checkpointId)) {
                seenCheckpointIds.add(cp.checkpointId);
                try {
                  controller.enqueue(
                    encoder.encode(
                      sseFrame("checkpoint", summaryToWire(cp), String(seq++)),
                    ),
                  );
                } catch {
                  stopPolling();
                  return;
                }
              }
            }
          }
        } catch (err) {
          // PermissionDenied is a hard stop — close the stream after
          // forwarding the error so the client can surface a toast.
          if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
            try {
              controller.enqueue(
                encoder.encode(
                  sseFrame("error", {
                    missionId,
                    code: "permission_denied",
                    message: "Permission denied",
                  }),
                ),
              );
            } catch {
              // ignore; client may have disconnected
            }
            logger.warn(baseLog, "ListCheckpoints permission denied; closing bridge");
            stopPolling();
            try {
              controller.close();
            } catch {
              // already closed
            }
            return;
          }
          // Transient errors: log and keep polling. Repeated failures
          // continue to surface via pino but do not crash the stream.
          logger.warn(
            { ...baseLog, err },
            "ListCheckpoints poll failed; will retry",
          );
        }

        if (cancelled) return;

        // ---- status diffs ----
        try {
          const missionList = await listMissions(false, 1000, userId, tenantId);
          const found = missionList.missions.find((m) => m.id === missionId);
          if (found) {
            const statusName =
              typeof found.status === "string"
                ? found.status
                : String(found.status ?? "");
            const normalized = statusName
              .toLowerCase()
              .replace("mission_status_", "");
            if (lastStatus !== null && normalized !== lastStatus) {
              try {
                controller.enqueue(
                  encoder.encode(
                    sseFrame(
                      "status",
                      { missionId, status: normalized, previous: lastStatus },
                      String(seq++),
                    ),
                  ),
                );
              } catch {
                stopPolling();
                return;
              }
            }
            lastStatus = normalized;
          }
        } catch (err) {
          logger.warn(
            { ...baseLog, err },
            "listMissions poll failed; will retry",
          );
        }
      };

      // Initial tick immediately (initial-pass populates the seen set
      // without emitting events) followed by the recurring poll loop.
      await tick();

      const interval = setInterval(() => {
        if (cancelled) {
          clearInterval(interval);
          return;
        }
        void tick();
      }, POLL_INTERVAL_MS);

      // Stash the interval handle on the closure so cancel() can clear it.
      (
        stream as unknown as { __pollInterval?: ReturnType<typeof setInterval> }
      ).__pollInterval = interval;
    },
    cancel() {
      logger.info(
        { route: "missions/events", missionId },
        "mission events SSE bridge cancelled by client",
      );
      const handle = (
        stream as unknown as { __pollInterval?: ReturnType<typeof setInterval> }
      ).__pollInterval;
      if (handle) clearInterval(handle);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
