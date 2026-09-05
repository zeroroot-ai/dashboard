/**
 * stream-json renderer tests (dashboard#1144).
 *
 * Every Claude Code stream-json event kind renders to a readable, colored
 * line. A line that is not JSON passes through verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  renderAgentLine,
  mergeSummary,
  formatCost,
  formatDuration,
  shortId,
} from "../stream-json";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const GREY = "\x1b[90m";
const ACID = "\x1b[92m";

function j(v: unknown): string {
  return JSON.stringify(v);
}

describe("renderAgentLine", () => {
  it("passes a non-JSON line through verbatim with CRLF", () => {
    expect(renderAgentLine("hello world")).toEqual({ text: "hello world\r\n" });
    expect(renderAgentLine("{not json")).toEqual({ text: "{not json\r\n" });
    expect(renderAgentLine("[1,2]")).toEqual({ text: "[1,2]\r\n" });
  });

  it("renders assistant text as plain lines and reports the model", () => {
    const out = renderAgentLine(
      j({
        type: "assistant",
        message: {
          model: "claude-opus-5",
          content: [{ type: "text", text: "first line\nsecond line" }],
        },
      }),
    );
    expect(out.text).toBe("first line\r\nsecond line\r\n");
    expect(out.summary).toEqual({ model: "claude-opus-5" });
  });

  it("renders a tool_use as the tool name plus a short input", () => {
    const out = renderAgentLine(
      j({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "sleep 10 && echo round-1-done", description: "x" },
            },
          ],
        },
      }),
    );
    expect(out.text).toContain(`${CYAN}▶ Bash${RESET}`);
    expect(out.text).toContain("sleep 10 && echo round-1-done");
    expect(out.text).not.toContain("description");
    expect(out.text.endsWith("\r\n")).toBe(true);
  });

  it("cuts a long tool input to one line", () => {
    const long = "x".repeat(400) + "\n" + "y".repeat(10);
    const out = renderAgentLine(
      j({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Write", input: { content: long } }] },
      }),
    );
    expect(out.text.split("\r\n").filter(Boolean)).toHaveLength(1);
    expect(out.text).toContain("…");
    expect(out.text.length).toBeLessThan(260);
  });

  it("renders a tool_result ok in green with the first line and a count", () => {
    const out = renderAgentLine(
      j({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "round-1-done\nmore\nlines",
            },
          ],
        },
      }),
    );
    expect(out.text).toContain(`${GREEN}✓ ok${RESET}`);
    expect(out.text).toContain("round-1-done");
    expect(out.text).toContain("(+2 lines)");
  });

  it("renders a tool_result error in red, reading text blocks", () => {
    const out = renderAgentLine(
      j({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              is_error: true,
              content: [{ type: "text", text: "command not found" }],
            },
          ],
        },
      }),
    );
    expect(out.text).toContain(`${RED}✗ error${RESET}`);
    expect(out.text).toContain("command not found");
  });

  it("renders the system init dimmed with session, model and tool count", () => {
    const out = renderAgentLine(
      j({
        type: "system",
        subtype: "init",
        session_id: "0123456789abcdef",
        model: "claude-opus-5",
        cwd: "/work",
        tools: ["Bash", "Read"],
      }),
    );
    expect(out.text.startsWith(GREY)).toBe(true);
    expect(out.text).toContain("system init");
    expect(out.text).toContain("session 01234567");
    expect(out.text).toContain("claude-opus-5");
    expect(out.text).toContain("2 tools");
    expect(out.summary).toEqual({ sessionId: "0123456789abcdef", model: "claude-opus-5" });
  });

  it("renders a thinking block dimmed on one line", () => {
    const out = renderAgentLine(
      j({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "plan\nthe\nwork" }] },
      }),
    );
    expect(out.text.startsWith(GREY)).toBe(true);
    expect(out.text).toContain("∴ plan the work");
    expect(out.text.split("\r\n").filter(Boolean)).toHaveLength(1);
  });

  it("renders the success result as an acid footer with turns, cost and session", () => {
    const out = renderAgentLine(
      j({
        type: "result",
        subtype: "success",
        num_turns: 3,
        total_cost_usd: 0.1301,
        duration_ms: 185000,
        session_id: "abcdefgh-1234",
        result: "all done",
      }),
    );
    expect(out.text).toContain(`${ACID}── done · 3 turns · $0.13 · 3m 05s · session abcdefgh ──${RESET}`);
    expect(out.summary).toEqual({
      turns: 3,
      costUsd: 0.1301,
      durationMs: 185000,
      sessionId: "abcdefgh-1234",
    });
  });

  it("renders an error result in red with the message", () => {
    const out = renderAgentLine(
      j({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 1,
        result: "hit the turn limit",
      }),
    );
    expect(out.text).toContain(`${RED}── failed (error_max_turns) · 1 turn ──${RESET}`);
    expect(out.text).toContain("hit the turn limit");
  });

  it("renders an unknown JSON object dimmed with its type", () => {
    const out = renderAgentLine(j({ type: "stream_event", event: { a: 1 } }));
    expect(out.text.startsWith(GREY)).toBe(true);
    expect(out.text).toContain("stream_event");
    expect(out.text).toContain('"a":1');
    expect(out.text.endsWith(`${RESET}\r\n`)).toBe(true);
  });

  it("renders nothing for an assistant message with no readable blocks", () => {
    const out = renderAgentLine(j({ type: "assistant", message: { content: [] } }));
    expect(out.text).toBe("");
  });
});

describe("helpers", () => {
  it("mergeSummary keeps identity when nothing changes", () => {
    const base = { model: "m" };
    expect(mergeSummary(base, undefined)).toBe(base);
    expect(mergeSummary(base, { model: "m" })).toBe(base);
    expect(mergeSummary(base, { turns: 2 })).toEqual({ model: "m", turns: 2 });
  });

  it("formats cost, duration and short ids", () => {
    expect(formatCost(0.13)).toBe("$0.13");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatDuration(42000)).toBe("42s");
    expect(formatDuration(185000)).toBe("3m 05s");
    expect(shortId("abc")).toBe("abc");
    expect(shortId("0123456789")).toBe("01234567");
  });
});
