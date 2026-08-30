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
 *
 * Fan-out (dashboard#1148): a page never holds more than a cap of open
 * EventSources. Surfaces declare demand for a live connection (a tile in
 * view, an open pop-out); the registry connects up to the cap and queues
 * the rest. A stream that disconnects keeps its buffer and the last event
 * sequence it saw, so the next connection asks the server for the tail
 * after it (`?since=<seq>`) and backfills without a gap or a duplicate.
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
  /** Per-run event sequence from the daemon, as a decimal string. */
  seq?: string;
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
  /** The last event sequence received, the cursor for the next connection. */
  private lastSeq = BigInt(0);
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

  /** True while an EventSource is open. */
  get connected(): boolean {
    return this.es !== null;
  }

  /** The cursor the next connection resumes from. */
  get cursor(): bigint {
    return this.lastSeq;
  }

  /**
   * Opens the EventSource, resuming after the last sequence seen. A call
   * while connected, or after the stream ended, is a no-op.
   */
  start(open: (url: string) => EventSourceLike): void {
    if (this.es || this._status.phase !== "streaming") return;
    const since = this.lastSeq > BigInt(0) ? "?since=" + this.lastSeq.toString() : "";
    const es = open("/api/agents/" + this.runId + "/events" + since);
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

  /**
   * Closes the EventSource. Buffered text and the cursor stay, so a later
   * start() backfills the tail from the server.
   */
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
    if (payload.seq !== undefined && /^\d+$/.test(payload.seq)) {
      const seq = BigInt(payload.seq);
      // The server replays after the cursor, so a repeat is a bug upstream;
      // drop it rather than show a duplicate line.
      if (seq <= this.lastSeq) return;
      this.lastSeq = seq;
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

/** Default cap on open EventSources per page. */
export const DEFAULT_STREAM_CAP = 6;

/** What the wall header shows about the fan-out. */
interface StreamStats {
  cap: number;
  /** Streams with an open EventSource. */
  live: number;
  /** Runs that want a live connection and wait for a slot. */
  waiting: number;
}

interface RegistryEntry {
  stream: AgentStream;
  /** Surfaces that hold the stream (tile, pop-out). */
  holders: number;
  /** Surfaces that want a live connection right now. */
  demand: number;
  unwatch: () => void;
}

interface AgentStreamRegistryOptions {
  open?: (url: string) => EventSourceLike;
  /** Maximum open EventSources at once. */
  cap?: number;
}

/**
 * Hands out one AgentStream per run id, keeps it while any surface holds
 * it, and connects at most `cap` streams at once. Surfaces declare demand
 * for a live connection; demand beyond the cap queues in order and
 * connects as slots free up. The wall owns one registry, so a tile and its
 * pop-out share the same stream.
 */
export class AgentStreamRegistry {
  private readonly streams = new Map<string, RegistryEntry>();
  private readonly queue: string[] = [];
  private readonly open: (url: string) => EventSourceLike;
  readonly cap: number;
  private readonly listeners = new Set<(s: StreamStats) => void>();

  constructor(opts: AgentStreamRegistryOptions | ((url: string) => EventSourceLike) = {}) {
    const o = typeof opts === "function" ? { open: opts } : opts;
    this.open = o.open ?? ((url) => new EventSource(url));
    this.cap = Math.max(1, o.cap ?? DEFAULT_STREAM_CAP);
  }

  /** Returns the run's stream, creating it on first acquire. */
  acquire(runId: string): AgentStream {
    let entry = this.streams.get(runId);
    if (!entry) {
      const stream = new AgentStream(runId);
      const e: RegistryEntry = { stream, holders: 0, demand: 0, unwatch: () => {} };
      // A stream that ends frees its slot for the next in the queue.
      e.unwatch = stream.watch((st) => {
        if (st.phase !== "streaming") this.pump();
      });
      this.streams.set(runId, e);
      entry = e;
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
      entry.unwatch();
      entry.stream.close();
      this.streams.delete(runId);
      this.dequeue(runId);
      this.pump();
    }
  }

  /**
   * Declares or withdraws one surface's demand for a live connection. The
   * stream connects when a slot is free, else it waits in order. When the
   * last demand goes, the stream disconnects and keeps its buffer.
   */
  setLive(runId: string, live: boolean): void {
    const entry = this.streams.get(runId);
    if (!entry) return;
    entry.demand += live ? 1 : -1;
    if (entry.demand < 0) entry.demand = 0;
    if (entry.demand > 0) {
      if (!entry.stream.connected && !this.queue.includes(runId)) this.queue.push(runId);
    } else {
      this.dequeue(runId);
      if (entry.stream.connected) entry.stream.close();
    }
    this.pump();
  }

  /** Connects queued streams while slots are free, then reports stats. */
  private pump(): void {
    let live = this.liveCount();
    while (live < this.cap && this.queue.length > 0) {
      const runId = this.queue.shift() as string;
      const entry = this.streams.get(runId);
      if (!entry || entry.demand <= 0 || entry.stream.connected) continue;
      if (entry.stream.status.phase !== "streaming") continue;
      entry.stream.start(this.open);
      live = this.liveCount();
    }
    const stats = this.stats();
    for (const fn of this.listeners) fn(stats);
  }

  private dequeue(runId: string): void {
    const i = this.queue.indexOf(runId);
    if (i >= 0) this.queue.splice(i, 1);
  }

  private liveCount(): number {
    let n = 0;
    for (const e of this.streams.values()) if (e.stream.connected) n++;
    return n;
  }

  /** Current fan-out numbers for the wall header. */
  stats(): StreamStats {
    return { cap: this.cap, live: this.liveCount(), waiting: this.queue.length };
  }

  /** Watches the stats. Fires at once with the current value. */
  onStats(fn: (s: StreamStats) => void): () => void {
    fn(this.stats());
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Number of known streams, for tests. */
  get size(): number {
    return this.streams.size;
  }
}
