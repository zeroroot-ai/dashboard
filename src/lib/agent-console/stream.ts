/**
 * AgentStream, one live stream per running agent (dashboard#1147).
 *
 * One EventSource per run, no matter how many surfaces show it. The stream
 * keeps a bounded buffer of rendered terminal text, so a surface that opens
 * later (a pop-out over a tile) replays what the tile already has and then
 * follows live. Nothing reconnects and nothing replays from the server.
 *
 * The stream renders Claude Code stream-json lines with the pure renderer
 * and tracks a status: the phase (streaming, finished, gone, error) and the
 * facts the stream reveals (model, session, turns, cost).
 */

import {
  mergeSummary,
  renderAgentLine,
  type AgentRunSummary,
} from "@/src/lib/agent-console/stream-json";

const LINE_ENDED = "\x1b[32m✓ Agent finished\x1b[0m\r\n";
const LINE_NOT_FOUND = "\x1b[33m⏹ Agent is no longer running\x1b[0m\r\n";
const LINE_ERROR = "\x1b[31m✗ Stream error\x1b[0m\r\n";

/** Rendered writes kept for replay. Matches the terminal scrollback. */
const BUFFER_CAP = 5000;

/** Where the stream stands. `streaming` until the server closes it. */
export type AgentConsolePhase = "streaming" | "finished" | "gone" | "error";

/** Live status of one run, derived from the stream (dashboard#1144). */
export interface AgentConsoleStatus {
  phase: AgentConsolePhase;
  summary: AgentRunSummary;
}

/** A surface that shows terminal text. */
interface StreamSink {
  write: (text: string) => void;
}

/** The subset of EventSource the stream uses. Tests pass a fake. */
export interface EventSourceLike {
  addEventListener: (name: string, fn: (e: MessageEvent<string>) => void) => void;
  close: () => void;
}

interface ChunkPayload {
  unixNanos?: string;
  dataB64?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class AgentStream {
  readonly runId: string;
  private es: EventSourceLike | null = null;
  private readonly decoder = new TextDecoder();
  private pending = "";
  private buffer: string[] = [];
  private readonly sinks = new Set<StreamSink>();
  private readonly watchers = new Set<(s: AgentConsoleStatus) => void>();
  private _status: AgentConsoleStatus = { phase: "streaming", summary: {} };

  constructor(runId: string) {
    this.runId = runId;
  }

  get status(): AgentConsoleStatus {
    return this._status;
  }

  /** Opens the EventSource. A second call is a no-op. */
  start(open: (url: string) => EventSourceLike): void {
    if (this.es) return;
    const es = open("/api/agents/" + this.runId + "/events");
    this.es = es;
    es.addEventListener("chunk", this.handleChunk);
    es.addEventListener("end", () => this.finish(LINE_ENDED, "finished"));
    es.addEventListener("notfound", () => this.finish(LINE_NOT_FOUND, "gone"));
    // EventSource fires a native `error` event on transient disconnects,
    // with no `data`. Only a named `event: error` frame (which always
    // carries a `data:` line) is a fatal upstream failure. Ignore the
    // transient ones so the browser can reconnect.
    es.addEventListener("error", (e) => {
      if (typeof e.data !== "string" || e.data.length === 0) return;
      this.finish(LINE_ERROR, "error");
    });
  }

  /**
   * Attaches a surface. It first receives every buffered write, then every
   * live write. Returns the detach function.
   */
  subscribe(sink: StreamSink): () => void {
    for (const text of this.buffer) sink.write(text);
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  /** Watches the status. Fires at once with the current value. */
  watch(fn: (s: AgentConsoleStatus) => void): () => void {
    fn(this._status);
    this.watchers.add(fn);
    return () => {
      this.watchers.delete(fn);
    };
  }

  /** Closes the EventSource. Buffered text stays for late surfaces. */
  close(): void {
    this.es?.close();
    this.es = null;
  }

  private write(text: string): void {
    this.buffer.push(text);
    if (this.buffer.length > BUFFER_CAP) {
      this.buffer.splice(0, this.buffer.length - BUFFER_CAP);
    }
    for (const sink of this.sinks) sink.write(text);
  }

  private setStatus(next: AgentConsoleStatus): void {
    if (next === this._status) return;
    this._status = next;
    for (const fn of this.watchers) fn(next);
  }

  private writeLine(line: string): void {
    const rendered = renderAgentLine(line);
    if (rendered.text.length > 0) this.write(rendered.text);
    if (rendered.summary) {
      const summary = mergeSummary(this._status.summary, rendered.summary);
      if (summary !== this._status.summary) {
        this.setStatus({ ...this._status, summary });
      }
    }
  }

  private flushComplete(text: string): void {
    this.pending += text;
    let nl = this.pending.indexOf("\n");
    while (nl !== -1) {
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      this.writeLine(line);
      nl = this.pending.indexOf("\n");
    }
  }

  private readonly handleChunk = (e: MessageEvent<string>): void => {
    let payload: ChunkPayload;
    try {
      payload = JSON.parse(e.data) as ChunkPayload;
    } catch {
      return;
    }
    if (!payload.dataB64) return;
    let text: string;
    try {
      text = this.decoder.decode(base64ToBytes(payload.dataB64), { stream: true });
    } catch {
      return;
    }
    this.flushComplete(text);
  };

  private finish(line: string, phase: AgentConsolePhase): void {
    // Flush any trailing partial line the agent left without a newline.
    if (this.pending.length > 0) {
      this.writeLine(this.pending);
      this.pending = "";
    }
    this.close();
    this.write(line);
    this.setStatus({ ...this._status, phase });
  }
}

/**
 * Hands out one AgentStream per run id and closes it when the last holder
 * releases it. The wall owns one registry, so a tile and its pop-out share
 * the same stream.
 */
export class AgentStreamRegistry {
  private readonly streams = new Map<string, { stream: AgentStream; holders: number }>();
  private readonly open: (url: string) => EventSourceLike;

  constructor(open: (url: string) => EventSourceLike = (url) => new EventSource(url)) {
    this.open = open;
  }

  /** Returns the run's stream, opening it on first acquire. */
  acquire(runId: string): AgentStream {
    let entry = this.streams.get(runId);
    if (!entry) {
      entry = { stream: new AgentStream(runId), holders: 0 };
      this.streams.set(runId, entry);
      entry.stream.start(this.open);
    }
    entry.holders++;
    return entry.stream;
  }

  /** Drops one holder. The last release closes and forgets the stream. */
  release(runId: string): void {
    const entry = this.streams.get(runId);
    if (!entry) return;
    entry.holders--;
    if (entry.holders <= 0) {
      entry.stream.close();
      this.streams.delete(runId);
    }
  }

  /** Number of open streams, for tests and the wall header. */
  get size(): number {
    return this.streams.size;
  }
}
