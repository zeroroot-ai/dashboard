/**
 * GET /api/missions/:id/events
 *
 * Dashboard-side Server-Sent Events bridge for mission lifecycle events.
 *
 * Forwards the following daemon-derived events to the browser as named
 * SSE frames:
 *
 *   - `event: status`     , mission status transition (pending → running
 *                            → paused → completed / failed / stopped).
 *                            Payload: { missionId, status }.
 *   - `event: log`        , one mission log line, while the mission runs.
 *                            Payload: { timestamp, level, message, component }.
 *   - `event: node`       , a mission DAG node changed lifecycle phase.
 *                            Payload: { missionId, nodeId, phase } where
 *                            phase is "started" | "completed" | "failed".
 *                            Consumed by `<MissionFlowTab />` to paint the
 *                            flow-chart run overlay live (gibson#604).
 *
 * This bridge used to also emit `event: checkpoint` frames, polled off
 * `DaemonService.ListCheckpoints` for the checkpoint browser. gibson#1117
 * removed the checkpoint store and gibson#1321 removed the hollow RPCs that
 * survived it, so both the poll and the frame are gone; mission-state-at-a-tick
 * is now the World snapshot surface (`WorldService.GetFrameAt`), which reads
 * its own route. Nothing consumed the frame after the browser was retired.
 *
 * Implementation note: the status / log frames use a short-interval poll over
 * the unary `DaemonService.ListMissions` RPC (tenant-scoped via the userClient)
 * plus the LogsService tail, and emit diffs. The `node` frames instead consume
 * the daemon's server-streaming `DaemonService.Subscribe` RPC, filtered to this
 * mission's `node.*` events, the orchestrator publishes those to the tenant
 * Redis Stream backing Subscribe. Both run concurrently against the same SSE
 * controller.
 *
 * Security model:
 *   - The userClient flows through Envoy + ext-authz + SPIFFE-mTLS per
 *     dashboard `CLAUDE.md`; no direct daemon gRPC channel.
 *   - We do NOT propagate client `request.signal` aborts upstream, when
 *     the browser disconnects we just stop the polling loop. The
 *     underlying daemon RPC has no in-flight stream to cancel.
 */

import { NextRequest } from "next/server";

import { logger } from "@/src/lib/logger";
import { getServerSession } from "@/src/lib/auth";
import { requireActiveTenant, activeTenantApiResponse } from "@/src/lib/auth/active-tenant";
import { queryMissionLogs } from "@/src/lib/gibson-client/logs";
import { listMissions, userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";

// Polling cadence for the underlying daemon RPCs. 3s strikes a balance
// between dashboard freshness and daemon load.
const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;

// Nanoseconds-per-millisecond, as a BigInt. The tsconfig target is ES2017,
// which disallows BigInt literals (`1_000_000n`), so we construct via BigInt().
const NS_PER_MS = BigInt(1_000_000);

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

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
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

  // Shared handle so both start() and cancel() can clear the heartbeat.
  let heartbeatHandle: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      logger.info(baseLog, "mission events SSE bridge opened");

      // Open frame so EventSource flips to OPEN promptly on the client.
      try {
        controller.enqueue(encoder.encode(`: open\n\n`));
      } catch {
        return;
      }

      heartbeatHandle = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatHandle);
        }
      }, HEARTBEAT_INTERVAL_MS);

      let lastStatus: string | null = null;
      let cancelled = false;
      let seq = 0;

      // ---- mission log tail ----
      // While the mission is `running` we tail the daemon LogsService for this
      // mission's log lines and forward each as an `event: log` frame. We
      // initialise the cursor to "now" so we never replay historical lines on
      // connect, the logs tab (GET .../logs) owns the backfill; this bridge is
      // live-only. The daemon derives the tenant scope server-side
      // (dashboard#811); the dashboard never talks to Loki directly. Any RPC
      // failure is swallowed below so log frames are best-effort and never
      // crash the status bridge.
      let lastLogTimestampNs = BigInt(Date.now()) * NS_PER_MS;

      // Aborts the daemon node-event subscription (below) on teardown so the
      // upstream Subscribe stream is canceled when the browser disconnects.
      const nodeAbort = new AbortController();

      // Tear down state shared between the polling loop and the
      // ReadableStream `cancel` hook below.
      const stopPolling = () => {
        cancelled = true;
        clearInterval(heartbeatHandle);
        nodeAbort.abort();
      };

      const userId = session.user?.id ?? undefined;

      // ---- per-node lifecycle events (live flow-chart overlay) ----
      // The orchestrator publishes node.started / node.completed / node.failed
      // to the tenant Redis Stream that backs DaemonService.Subscribe, each
      // carrying the mission node id on MissionEvent.nodeId. We forward them as
      // `event: node` frames so MissionFlowTab can paint the flow-chart overlay
      // ("checked lines") in real time as a run progresses (gibson#604).
      //
      // Best-effort and independent of the poll loop: if Subscribe is
      // unavailable the status bridge keeps working and the overlay
      // simply stays static. We run it as a detached pump rather than inside
      // `tick` because Subscribe is a long-lived server stream, not a unary
      // poll. The `for await` yields control between frames, so it shares the
      // single-threaded controller with the poll loop without contention.
      void (async () => {
        try {
          const nodeStream = userClient(DaemonService).subscribe(
            {
              eventTypes: ["node.started", "node.completed", "node.failed"],
              missionId,
            },
            { signal: nodeAbort.signal },
          );
          for await (const ev of nodeStream) {
            if (cancelled) break;
            // node.* events arrive as MissionEvent on the response oneof.
            const nodeId =
              ev.event.case === "missionEvent" ? ev.event.value.nodeId : "";
            if (!nodeId) continue;
            const phase =
              ev.eventType === "node.completed"
                ? "completed"
                : ev.eventType === "node.failed"
                  ? "failed"
                  : "started";
            try {
              controller.enqueue(
                encoder.encode(
                  sseFrame("node", { missionId, nodeId, phase }, String(seq++)),
                ),
              );
            } catch {
              stopPolling();
              break;
            }
          }
        } catch (err) {
          // An abort on disconnect is expected; surface anything else.
          if (!nodeAbort.signal.aborted) {
            logger.warn(
              { ...baseLog, err },
              "node-event subscription unavailable; flow overlay stays static",
            );
          }
        }
      })();

      // Single poll iteration: read the mission status + tail its logs and
      // emit diffs.
      const tick = async () => {
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

        if (cancelled) return;

        // ---- mission log tail ----
        // Only tail while the mission is actively running. When status leaves
        // `running` this branch is skipped, so log frames naturally stop. The
        // tail is best-effort: any RPC error (including an unavailable log
        // backend) is swallowed so the status bridge keeps polling.
        // The daemon LogsService derives the tenant scope server-side
        // (dashboard#811); the dashboard never queries Loki directly. This
        // branch is exercised by this route's __tests__ suite (queryMissionLogs
        // mocked) and end-to-end against a live Kind cluster; transient backend
        // failures are intentionally silent here.
        if (lastStatus === "running") {
          try {
            const entries = await queryMissionLogs(missionId, {
              start: new Date(Number(lastLogTimestampNs / NS_PER_MS)),
              end: new Date(),
              limit: 100,
            });

            let maxTsNs = lastLogTimestampNs;
            for (const entry of entries) {
              const tsNs = BigInt(entry.timestamp.getTime()) * NS_PER_MS;
              // Skip lines at or before the cursor: the daemon's `start` is
              // inclusive, so the most recent already-emitted line can come
              // back again on the next poll.
              if (tsNs < lastLogTimestampNs) continue;

              // A log entry carries the raw line + labels; the level /
              // message / component live inside the structured JSON payload
              // (same parse shape as GET .../logs).
              let parsed: Record<string, unknown> = {};
              try {
                parsed = JSON.parse(entry.line);
              } catch {
                parsed = { msg: entry.line };
              }
              const level = (parsed.level as string)?.toLowerCase() || "info";
              const message =
                (parsed.msg as string) ||
                (parsed.message as string) ||
                entry.line;
              const component = parsed.component as string | undefined;

              try {
                controller.enqueue(
                  encoder.encode(
                    sseFrame(
                      "log",
                      {
                        timestamp: entry.timestamp.toISOString(),
                        level,
                        message,
                        component,
                      },
                      String(seq++),
                    ),
                  ),
                );
              } catch {
                stopPolling();
                return;
              }

              if (tsNs > maxTsNs) maxTsNs = tsNs;
            }

            // Advance the cursor past the newest line seen (+1ns) so the
            // next poll never re-emits it.
            if (maxTsNs >= lastLogTimestampNs) {
              lastLogTimestampNs = maxTsNs + BigInt(1);
            }
          } catch (err) {
            logger.warn(
              { ...baseLog, err },
              "mission log tail poll failed; will retry",
            );
          }
        }
      };

      // Initial tick immediately (it seeds lastStatus, so the first observed
      // status is a baseline rather than a transition) followed by the
      // recurring poll loop.
      await tick();

      const interval = setInterval(() => {
        if (cancelled) {
          clearInterval(interval);
          return;
        }
        void tick();
      }, POLL_INTERVAL_MS);

      // Stash the interval handle + node-stream aborter on the closure so
      // cancel() can clear them when the browser disconnects.
      (
        stream as unknown as {
          __pollInterval?: ReturnType<typeof setInterval>;
          __nodeAbort?: AbortController;
        }
      ).__pollInterval = interval;
      (
        stream as unknown as {
          __pollInterval?: ReturnType<typeof setInterval>;
          __nodeAbort?: AbortController;
        }
      ).__nodeAbort = nodeAbort;
    },
    cancel() {
      logger.info(
        { route: "missions/events", missionId },
        "mission events SSE bridge cancelled by client",
      );
      clearInterval(heartbeatHandle);
      const stashed = stream as unknown as {
        __pollInterval?: ReturnType<typeof setInterval>;
        __nodeAbort?: AbortController;
      };
      if (stashed.__pollInterval) clearInterval(stashed.__pollInterval);
      stashed.__nodeAbort?.abort();
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
