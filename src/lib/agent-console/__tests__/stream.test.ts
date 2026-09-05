/**
 * AgentStream and AgentStreamRegistry tests (dashboard#1147).
 *
 * One EventSource per run, a replay buffer for late surfaces, and the
 * status phases. Chunk decoding and reassembly moved here from the hook.
 */
import { describe, it, expect, vi } from "vitest";
import { AgentStream, AgentStreamRegistry, type EventSourceLike } from "../stream";

class FakeEventSource implements EventSourceLike {
  listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {};
  closeSpy = vi.fn();
  constructor(public url: string) {}
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners[name] = [...(this.listeners[name] ?? []), fn];
  }
  close() {
    this.closeSpy();
  }
  emit(name: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent<string>;
    this.listeners[name]?.forEach((fn) => fn(ev));
  }
  emitRaw(name: string, data?: string) {
    const ev = { data } as MessageEvent<string>;
    this.listeners[name]?.forEach((fn) => fn(ev));
  }
}

function b64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

function open() {
  const sources: FakeEventSource[] = [];
  const opener = (url: string) => {
    const es = new FakeEventSource(url);
    sources.push(es);
    return es;
  };
  return { sources, opener };
}

describe("AgentStream", () => {
  it("opens the run's events route once and writes decoded lines", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-1");
    s.start(opener);
    s.start(opener);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("/api/agents/run-1/events");
    const write = vi.fn();
    s.subscribe({ write });
    sources[0].emit("chunk", { unixNanos: "1", dataB64: b64("hello world\n") });
    expect(write).toHaveBeenCalledWith("hello world\r\n");
  });

  it("reassembles a line split across chunks and splits two records", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-2");
    s.start(opener);
    const write = vi.fn();
    s.subscribe({ write });
    sources[0].emit("chunk", { dataB64: b64("round-1-d") });
    expect(write).not.toHaveBeenCalled();
    sources[0].emit("chunk", { dataB64: b64("one\nsecond\n") });
    expect(write).toHaveBeenNthCalledWith(1, "round-1-done\r\n");
    expect(write).toHaveBeenNthCalledWith(2, "second\r\n");
  });

  it("replays the buffer to a late surface and then follows live", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-3");
    s.start(opener);
    const tile = vi.fn();
    s.subscribe({ write: tile });
    sources[0].emit("chunk", { dataB64: b64("one\ntwo\n") });
    const popout = vi.fn();
    const detach = s.subscribe({ write: popout });
    expect(popout.mock.calls.map((c) => c[0])).toEqual(["one\r\n", "two\r\n"]);
    sources[0].emit("chunk", { dataB64: b64("three\n") });
    expect(popout).toHaveBeenLastCalledWith("three\r\n");
    expect(tile).toHaveBeenLastCalledWith("three\r\n");
    detach();
    sources[0].emit("chunk", { dataB64: b64("four\n") });
    expect(popout).toHaveBeenCalledTimes(3);
    expect(tile).toHaveBeenCalledTimes(4);
    expect(sources).toHaveLength(1);
  });

  it("flushes a trailing partial line, closes and reports finished on end", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-4");
    s.start(opener);
    const write = vi.fn();
    const status = vi.fn();
    s.subscribe({ write });
    s.watch(status);
    expect(status).toHaveBeenLastCalledWith({ phase: "streaming", summary: {} });
    sources[0].emit("chunk", { dataB64: b64("no newline here") });
    sources[0].emit("end", { runId: "run-4" });
    expect(write).toHaveBeenNthCalledWith(1, "no newline here\r\n");
    expect(write).toHaveBeenNthCalledWith(2, "\x1b[32m✓ Agent finished\x1b[0m\r\n");
    expect(sources[0].closeSpy).toHaveBeenCalled();
    expect(s.status.phase).toBe("finished");
  });

  it("reports gone on notfound and error on a named error frame only", () => {
    const { sources, opener } = open();
    const gone = new AgentStream("run-5");
    gone.start(opener);
    sources[0].emit("notfound", { runId: "run-5" });
    expect(gone.status.phase).toBe("gone");

    const err = new AgentStream("run-6");
    err.start(opener);
    sources[1].emitRaw("error", undefined);
    expect(err.status.phase).toBe("streaming");
    expect(sources[1].closeSpy).not.toHaveBeenCalled();
    sources[1].emit("error", { message: "boom" });
    expect(err.status.phase).toBe("error");
    expect(sources[1].closeSpy).toHaveBeenCalled();
  });

  it("accumulates summary facts from stream-json lines", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-7");
    s.start(opener);
    const write = vi.fn();
    s.subscribe({ write });
    sources[0].emit("chunk", {
      dataB64: b64(
        JSON.stringify({ type: "system", subtype: "init", model: "m1", session_id: "s1" }) +
          "\n" +
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "hello" }] },
          }) +
          "\n" +
          JSON.stringify({ type: "result", subtype: "success", num_turns: 2, total_cost_usd: 0.05 }) +
          "\n",
      ),
    });
    expect(write).toHaveBeenCalledWith("hello\r\n");
    expect(s.status.summary).toEqual({ model: "m1", sessionId: "s1", turns: 2, costUsd: 0.05 });
  });

  it("ignores malformed chunk frames", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-8");
    s.start(opener);
    const write = vi.fn();
    s.subscribe({ write });
    sources[0].emitRaw("chunk", "not json");
    sources[0].emit("chunk", { unixNanos: "1" });
    sources[0].emit("chunk", { dataB64: "%%%" });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("AgentStreamRegistry", () => {
  it("shares one stream per run and closes it on the last release", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry(opener);
    const a = r.acquire("run-1");
    const b = r.acquire("run-1");
    expect(a).toBe(b);
    r.setLive("run-1", true);
    expect(sources).toHaveLength(1);
    expect(r.size).toBe(1);
    r.release("run-1");
    expect(sources[0].closeSpy).not.toHaveBeenCalled();
    r.release("run-1");
    expect(sources[0].closeSpy).toHaveBeenCalled();
    expect(r.size).toBe(0);
    r.release("run-1");
    expect(r.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fan-out: cap, queue, cursor (dashboard#1148)
// ---------------------------------------------------------------------------

describe("AgentStream cursor", () => {
  it("tracks the last seq, drops repeats, and resumes with ?since= on the next start", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-c");
    s.start(opener);
    const write = vi.fn();
    s.subscribe({ write });
    sources[0].emit("chunk", { seq: "1", dataB64: b64("one\n") });
    sources[0].emit("chunk", { seq: "2", dataB64: b64("two\n") });
    sources[0].emit("chunk", { seq: "2", dataB64: b64("two again\n") });
    expect(write.mock.calls.map((c) => c[0])).toEqual(["one\r\n", "two\r\n"]);
    expect(s.cursor).toBe(BigInt(2));
    s.close();
    expect(s.connected).toBe(false);
    s.start(opener);
    expect(sources).toHaveLength(2);
    expect(sources[1].url).toBe("/api/agents/run-c/events?since=2");
    sources[1].emit("chunk", { seq: "3", dataB64: b64("three\n") });
    expect(write).toHaveBeenLastCalledWith("three\r\n");
    // The buffer survives the reconnect for a late surface.
    const late = vi.fn();
    s.subscribe({ write: late });
    expect(late.mock.calls.map((c) => c[0])).toEqual(["one\r\n", "two\r\n", "three\r\n"]);
  });

  it("does not reopen after the stream ended", () => {
    const { sources, opener } = open();
    const s = new AgentStream("run-d");
    s.start(opener);
    sources[0].emit("end", { runId: "run-d" });
    s.start(opener);
    expect(sources).toHaveLength(1);
  });
});

describe("AgentStreamRegistry fan-out", () => {
  it("never opens more than the cap and queues the rest in order", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry({ open: opener, cap: 3 });
    const ids = Array.from({ length: 25 }, (_, i) => `run-${i}`);
    for (const id of ids) {
      r.acquire(id);
      r.setLive(id, true);
    }
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.url)).toEqual([
      "/api/agents/run-0/events",
      "/api/agents/run-1/events",
      "/api/agents/run-2/events",
    ]);
    expect(r.stats()).toEqual({ cap: 3, live: 3, waiting: 22 });
  });

  it("frees a slot when demand goes and when a stream ends", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry({ open: opener, cap: 2 });
    for (const id of ["a", "b", "c", "d"]) {
      r.acquire(id);
      r.setLive(id, true);
    }
    expect(sources.map((s) => s.url)).toEqual(["/api/agents/a/events", "/api/agents/b/events"]);
    // a scrolls out of view: its slot goes to c.
    r.setLive("a", false);
    expect(sources[0].closeSpy).toHaveBeenCalled();
    expect(sources.map((s) => s.url)).toEqual([
      "/api/agents/a/events",
      "/api/agents/b/events",
      "/api/agents/c/events",
    ]);
    expect(r.stats()).toEqual({ cap: 2, live: 2, waiting: 1 });
    // b finishes: its slot goes to d.
    sources[1].emit("end", { runId: "b" });
    expect(sources[3].url).toBe("/api/agents/d/events");
    expect(r.stats()).toEqual({ cap: 2, live: 2, waiting: 0 });
  });

  it("resumes a tile scrolled back into view from its cursor", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry({ open: opener, cap: 1 });
    const a = r.acquire("a");
    r.setLive("a", true);
    sources[0].emit("chunk", { seq: "7", dataB64: b64("seven\n") });
    r.setLive("a", false);
    expect(a.connected).toBe(false);
    r.setLive("a", true);
    expect(sources[1].url).toBe("/api/agents/a/events?since=7");
  });

  it("counts demand per surface, so a pop-out over a tile keeps one connection", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry({ open: opener, cap: 2 });
    r.acquire("a");
    r.acquire("a");
    r.setLive("a", true);
    r.setLive("a", true);
    expect(sources).toHaveLength(1);
    r.setLive("a", false);
    expect(sources[0].closeSpy).not.toHaveBeenCalled();
    r.setLive("a", false);
    expect(sources[0].closeSpy).toHaveBeenCalled();
    r.release("a");
    expect(r.size).toBe(1);
    r.release("a");
    expect(r.size).toBe(0);
  });

  it("reports stats to watchers and ignores demand for unknown runs", () => {
    const { opener } = open();
    const r = new AgentStreamRegistry({ open: opener, cap: 1 });
    const seen: number[] = [];
    const off = r.onStats((s) => seen.push(s.live));
    r.setLive("ghost", true);
    r.acquire("a");
    r.setLive("a", true);
    expect(seen).toEqual([0, 1]);
    off();
    r.setLive("a", false);
    expect(seen).toEqual([0, 1]);
  });

  it("accepts a bare opener for backward compatibility and enforces a cap of at least 1", () => {
    const { sources, opener } = open();
    const r = new AgentStreamRegistry(opener);
    expect(r.cap).toBe(6);
    const r0 = new AgentStreamRegistry({ open: opener, cap: 0 });
    expect(r0.cap).toBe(1);
    r.acquire("a");
    r.setLive("a", true);
    expect(sources).toHaveLength(1);
  });
});
