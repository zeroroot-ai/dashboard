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

export function useAgentConsole(
  runId: string | undefined,
  terminalRef: React.RefObject<MissionTerminalHandle | null>,
): void {
  React.useEffect(() => {
    if (!runId) return;

    const es = new EventSource('/api/agents/' + runId + '/events');
    const decoder = new TextDecoder();
    // Holds a partial NDJSON line carried across chunk boundaries so we only
    // ever write complete lines to the terminal.
    let pending = '';

    const write = (text: string) => {
      terminalRef.current?.write(text);
    };

    const flushComplete = (text: string) => {
      pending += text;
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        write(line + '\r\n');
        nl = pending.indexOf('\n');
      }
    };

    const close = () => {
      // Flush any trailing partial line the agent left without a newline.
      if (pending.length > 0) {
        write(pending + '\r\n');
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
    };

    const handleNotFound = () => {
      close();
      write(LINE_NOT_FOUND);
    };

    // EventSource fires a native `error` event on transient disconnects, with
    // no `data`. Only a named `event: error` frame (which always carries a
    // `data:` line) is a fatal upstream failure. Ignore the transient ones so
    // the browser can reconnect; act only on the named frame.
    const handleError = (e: MessageEvent<string>) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      close();
      write(LINE_ERROR);
    };

    es.addEventListener('chunk', handleChunk);
    es.addEventListener('end', handleEnd);
    es.addEventListener('notfound', handleNotFound);
    es.addEventListener('error', handleError);

    return () => {
      es.close();
    };
  }, [runId, terminalRef]);
}
