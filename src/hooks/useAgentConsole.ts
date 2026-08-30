/**
 * useAgentConsole
 *
 * Opens a native EventSource against `/api/agents/:runId/events` and writes one
 * running agent's live output into a MissionTerminal ref (ADR-0016 S12,
 * dashboard#1134). It mirrors `useMissionTerminal`: no React state is mutated,
 * every incoming frame is a direct ref call so the component incurs zero
 * re-renders per line.
 *
 * The bridge emits typed frames:
 *   - `chunk`    , one raw output chunk, base64 in `dataB64`. The daemon does
 *                  not parse the bytes and neither did the bridge; this hook
 *                  decodes them and reassembles the opencode NDJSON into lines,
 *                  then writes each line to the terminal verbatim.
 *   - `end`      , the run reached a terminal state; the feed closed.
 *   - `notfound` , the run is not a live instance in this tenant.
 *   - `error`    , an upstream failure.
 *
 * This surface is READ-ONLY. There is no input, no PTY, no write path back to
 * the agent. The EventSource is closed on any terminal frame and on cleanup.
 */

import * as React from 'react';
import type { MissionTerminalHandle } from '@/src/components/missions/MissionTerminal';
import {
  mergeSummary,
  renderAgentLine,
  type AgentRunSummary,
} from '@/src/lib/agent-console/stream-json';

const LINE_ENDED = '\x1b[32m✓ Agent finished\x1b[0m\r\n';
const LINE_NOT_FOUND =
  '\x1b[33m⏹ Agent is no longer running\x1b[0m\r\n';
const LINE_ERROR = '\x1b[31m✗ Stream error\x1b[0m\r\n';

interface ChunkPayload {
  unixNanos?: string;
  dataB64?: string;
}

/** base64 -> Uint8Array, using the browser's `atob`. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Where the stream stands. `streaming` until the server closes it. */
export type AgentConsolePhase = 'streaming' | 'finished' | 'gone' | 'error';

/** Live status of one run, derived from the stream (dashboard#1144). */
interface AgentConsoleStatus {
  phase: AgentConsolePhase;
  summary: AgentRunSummary;
}

const INITIAL_STATUS: AgentConsoleStatus = { phase: 'streaming', summary: {} };

export function useAgentConsole(
  runId: string | undefined,
  terminalRef: React.RefObject<MissionTerminalHandle | null>,
): AgentConsoleStatus {
  const [status, setStatus] = React.useState<AgentConsoleStatus>(INITIAL_STATUS);
  React.useEffect(() => {
    if (!runId) return;
    setStatus(INITIAL_STATUS);
    const setPhase = (phase: AgentConsolePhase) => {
      setStatus((prev) => (prev.phase === phase ? prev : { ...prev, phase }));
    };
    const write = (text: string) => {
      terminalRef.current?.write(text);
    };
    // Render one raw stream line to readable terminal text, and keep the
    // facts it carried (model, turns, cost, session).
    const writeLine = (line: string) => {
      const rendered = renderAgentLine(line);
      if (rendered.text.length > 0) write(rendered.text);
      if (rendered.summary) {
        setStatus((prev) => {
          const summary = mergeSummary(prev.summary, rendered.summary);
          return summary === prev.summary ? prev : { ...prev, summary };
        });
      }
    };

    const es = new EventSource('/api/agents/' + runId + '/events');
    const decoder = new TextDecoder();
    // Holds a partial NDJSON line carried across chunk boundaries so we only
    // ever write complete lines to the terminal.
    let pending = '';


    const flushComplete = (text: string) => {
      pending += text;
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        writeLine(line);
        nl = pending.indexOf('\n');
      }
    };

    const close = () => {
      // Flush any trailing partial line the agent left without a newline.
      if (pending.length > 0) {
        writeLine(pending);
        pending = '';
      }
      es.close();
    };

    const handleChunk = (e: MessageEvent<string>) => {
      let payload: ChunkPayload;
      try {
        payload = JSON.parse(e.data) as ChunkPayload;
      } catch {
        return;
      }
      if (!payload.dataB64) return;
      let text: string;
      try {
        text = decoder.decode(base64ToBytes(payload.dataB64), { stream: true });
      } catch {
        return;
      }
      flushComplete(text);
    };

    const handleEnd = () => {
      close();
      write(LINE_ENDED);
      setPhase('finished');
    };

    const handleNotFound = () => {
      close();
      write(LINE_NOT_FOUND);
      setPhase('gone');
    };

    // EventSource fires a native `error` event on transient disconnects, with
    // no `data`. Only a named `event: error` frame (which always carries a
    // `data:` line) is a fatal upstream failure. Ignore the transient ones so
    // the browser can reconnect; act only on the named frame.
    const handleError = (e: MessageEvent<string>) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      close();
      write(LINE_ERROR);
      setPhase('error');
    };

    es.addEventListener('chunk', handleChunk);
    es.addEventListener('end', handleEnd);
    es.addEventListener('notfound', handleNotFound);
    es.addEventListener('error', handleError);

    return () => {
      es.close();
    };
  }, [runId, terminalRef]);
  return status;
}
