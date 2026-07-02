/**
 * GET /api/missions/:id/tool-stream/:invocationId
 *
 * Dashboard-side SSE bridge for the daemon's
 * `gibson.component.v1.ComponentService/CallToolStream` server-streaming
 * RPC. Translates each `CallToolStreamResponse` into a Server-Sent Event
 * frame keyed by `eventType` ("progress" | "partial" | "warning" | "error"
 * | "result"). The browser-side `EventSource` consumer (`ToolStreamProgress`)
 * subscribes to those event names and renders progress / partial / fatal
 * states accordingly.
 *
 * Spec:
 *   - week-4-handlers-ui-e2e §5 tasks 52, 55.
 *   - headline-feature-completion R1.6 (real proto events end-to-end),
 *     R1.8 (client disconnect drops bridge but does NOT cancel the
 *     underlying tool execution).
 *
 * Constraints (per dashboard CLAUDE.md):
 *   - Daemon traffic goes through Envoy + ext-authz via
 *     `userClient(ComponentService)`. No direct daemon gRPC channel.
 *   - Errors and lifecycle events go to the canonical pino logger.
 *   - Client disconnect closes ONLY the SSE side; the upstream stream's
 *     context is NOT cancelled, the daemon's ring buffer retains events
 *     for late reconnect (design.md). We deliberately do not propagate
 *     `request.signal` aborts upstream.
 */

import { NextRequest } from "next/server";
import { create } from "@bufbuild/protobuf";

import { logger } from "@/src/lib/logger";
import { getServerSession } from "@/src/lib/auth";
import { userClient } from "@/src/lib/gibson-client";
import { ComponentService } from "@/src/gen/gibson/component/v1/component_pb";
import { CallToolStreamRequestSchema } from "@/src/gen/gibson/component/v1/component_pb";

// SSE frames must end with `\n\n`. Helper builds a single frame with an
// optional `event:` line; the daemon's eventType doubles as the SSE event
// name so the browser's `EventSource.addEventListener('progress', ...)`
// dispatch works without a wrapper.
function sseFrame(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  if (event) lines.push(`event: ${event}`);
  const json = typeof data === "string" ? data : JSON.stringify(data);
  // SSE data lines must not contain raw newlines, split on \n.
  for (const line of json.split("\n")) {
    lines.push(`data: ${line}`);
  }
  lines.push(""); // terminator
  lines.push("");
  return lines.join("\n");
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; invocationId: string }>;
  },
) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id: missionId, invocationId } = await params;

  // Parse tool params from query string. The dashboard caller is expected
  // to pass `tool_name` (required) and an optional `input_json` payload
  // describing the upstream request.
  const url = new URL(request.url);
  const toolName = url.searchParams.get("tool_name") ?? "";
  const inputJson = url.searchParams.get("input_json") ?? "{}";
  const timeoutMsRaw = url.searchParams.get("timeout_ms");
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 0;

  if (!toolName) {
    return new Response(
      JSON.stringify({ error: "tool_name query parameter is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const baseLog = {
        route: "missions/tool-stream",
        missionId,
        invocationId,
        toolName,
      } as const;

      logger.info(baseLog, "tool-stream bridge opened");

      // Initial heartbeat so EventSource readyState moves to OPEN
      // promptly on the client.
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
      }, 15000);

      const req = create(CallToolStreamRequestSchema, {
        workId: invocationId,
        toolName,
        inputJson,
        timeoutMs: BigInt(Number.isFinite(timeoutMs) ? timeoutMs : 0),
      });

      try {
        const upstream = userClient(ComponentService).callToolStream(req);

        let seq = 0;
        for await (const event of upstream) {
          // Map daemon event types to SSE event names. Empty string
          // indicates a generic "message" event in SSE, for safety
          // we always emit a named event when the daemon has set one.
          const eventName = event.eventType || "message";
          const payload = {
            workId: invocationId,
            seq,
            eventType: event.eventType,
            payloadJson: event.payloadJson,
            done: event.done,
            error: event.error
              ? {
                  code: event.error.code,
                  message: event.error.message,
                }
              : null,
          };
          try {
            controller.enqueue(
              encoder.encode(sseFrame(eventName, payload, String(seq))),
            );
          } catch {
            // Client disconnected; bail out without cancelling upstream.
            break;
          }
          seq += 1;
          if (event.done) break;
        }
      } catch (err) {
        logger.warn({ ...baseLog, err }, "tool-stream upstream errored");
        try {
          controller.enqueue(
            encoder.encode(
              sseFrame("error", {
                workId: invocationId,
                message:
                  err instanceof Error ? err.message : "unknown stream error",
              }),
            ),
          );
        } catch {
          // ignore
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
        logger.info(baseLog, "tool-stream bridge closed");
      }
    },
    cancel() {
      // Browser-side disconnect. Spec headline-feature-completion R1.8:
      // do NOT propagate the cancel upstream, the daemon's ring buffer
      // keeps events for late reconnect. We just stop pumping the SSE
      // side; the for-await loop above will see the next enqueue throw
      // and break out without aborting the gRPC stream.
      logger.info(
        { route: "missions/tool-stream", missionId, invocationId },
        "tool-stream bridge cancelled by client",
      );
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
