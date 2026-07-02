/**
 * useMissionTerminal
 *
 * Opens a native EventSource against `/api/missions/:id/events` and writes
 * formatted ANSI lines directly to a MissionTerminal ref. No React state is
 * mutated inside the hook, every incoming SSE frame is a direct ref call so
 * the component incurs zero re-renders per incoming line.
 *
 * Named event listeners are used (not onmessage) because the SSE bridge emits
 * typed frames: status, tool_started, tool_completed, error, log.
 *
 * The EventSource is closed automatically when the mission reaches a terminal
 * status (completed, failed, stopped) and on useEffect cleanup.
 *
 * Spec: dashboard#384, live SSE status and tool events in MissionTerminal.
 */

import * as React from "react";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";

// ---------------------------------------------------------------------------
// ANSI line constants
// ---------------------------------------------------------------------------

const LINE_RUNNING = "\x1b[32m▶ Mission running\x1b[0m\r\n";
const LINE_PAUSED = "\x1b[33m⏸ Mission paused\x1b[0m\r\n";
const LINE_COMPLETED = "\x1b[32m✓ Mission completed\x1b[0m\r\n";
const LINE_FAILED = "\x1b[31m✗ Mission failed\x1b[0m\r\n";
const LINE_STOPPED = "\x1b[33m⏹ Mission stopped\x1b[0m\r\n";

// Terminal statuses that should close the EventSource
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

interface StatusPayload {
  missionId?: string;
  status: string;
  previous?: string;
}

interface ToolStartedPayload {
  toolName: string;
  invocationId: string;
}

interface ToolCompletedPayload {
  invocationId: string;
}

interface ErrorPayload {
  message?: string;
  code?: string;
  missionId?: string;
}

interface LogPayload {
  timestamp: string;
  level: string;
  message: string;
  component?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a structured log level to a coloured, fixed-width ANSI prefix so the
 * terminal renders an aligned `[LVL] HH:MM:SS message` gutter.
 */
function levelPrefix(level: string): string {
  switch (level) {
    case "error":
      return "\x1b[31m[ERR]\x1b[0m";
    case "warn":
      return "\x1b[33m[WRN]\x1b[0m";
    case "info":
      return "\x1b[36m[INF]\x1b[0m";
    case "debug":
      return "\x1b[2m[DBG]\x1b[0m";
    default:
      return "\x1b[2m[   ]\x1b[0m";
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMissionTerminal(
  missionId: string | undefined,
  terminalRef: React.RefObject<MissionTerminalHandle | null>,
): void {
  React.useEffect(() => {
    if (!missionId) return;

    const es = new EventSource("/api/missions/" + missionId + "/events");

    // Convenience writer, direct ref call, no setState
    const write = (line: string) => {
      terminalRef.current?.write(line);
    };

    // Close the EventSource and remove all listeners. Called on terminal
    // status or on cleanup.
    const close = () => {
      es.close();
    };

    // ---- status ----
    const handleStatus = (e: MessageEvent<string>) => {
      let payload: StatusPayload;
      try {
        payload = JSON.parse(e.data) as StatusPayload;
      } catch {
        return;
      }
      const status = payload.status ?? "";
      switch (status) {
        case "running":
          write(LINE_RUNNING);
          break;
        case "paused":
          write(LINE_PAUSED);
          break;
        case "completed":
          write(LINE_COMPLETED);
          close();
          break;
        case "failed":
          write(LINE_FAILED);
          close();
          break;
        case "stopped":
          write(LINE_STOPPED);
          close();
          break;
        // pending and unknown statuses are silent
        default:
          break;
      }
    };

    // ---- tool_started ----
    const handleToolStarted = (e: MessageEvent<string>) => {
      let payload: ToolStartedPayload;
      try {
        payload = JSON.parse(e.data) as ToolStartedPayload;
      } catch {
        return;
      }
      const toolName = payload.toolName ?? "";
      write("\x1b[33m⚙ Tool: " + toolName + "\x1b[0m\r\n");
    };

    // ---- tool_completed ----
    const handleToolCompleted = (_e: MessageEvent<string>) => {
      write("\x1b[33m  ↳ completed\x1b[0m\r\n");
    };

    // ---- error ----
    const handleError = (e: MessageEvent<string>) => {
      let message: string;
      try {
        const payload = JSON.parse(e.data) as ErrorPayload | string;
        if (typeof payload === "string") {
          message = payload;
        } else {
          message = payload.message ?? "Unknown error";
        }
      } catch {
        message = typeof e.data === "string" ? e.data : "Unknown error";
      }
      write("\x1b[31m! " + message + "\x1b[0m\r\n");
    };

    // ---- log ----
    const handleLog = (e: MessageEvent<string>) => {
      let payload: LogPayload;
      try {
        payload = JSON.parse(e.data) as LogPayload;
      } catch {
        return;
      }
      const prefix = levelPrefix(payload.level);
      const time = new Date(payload.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      write(`${prefix} ${time} ${payload.message}\r\n`);
    };

    es.addEventListener("status", handleStatus);
    es.addEventListener("tool_started", handleToolStarted);
    es.addEventListener("tool_completed", handleToolCompleted);
    es.addEventListener("error", handleError);
    es.addEventListener("log", handleLog);

    return () => {
      es.close();
    };
  }, [missionId, terminalRef]);
}
