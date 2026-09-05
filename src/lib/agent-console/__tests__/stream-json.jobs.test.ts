import { describe, it, expect } from "vitest";
import { renderAgentLine } from "../stream-json";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("stream-json bank member lines (gibson#1706)", () => {
  it("renders a job opened with its goal", () => {
    const r = renderAgentLine(JSON.stringify({ type: "job_opened", job_id: "job-12345678", goal: "fix the login bug" }));
    expect(strip(r.text)).toBe("◆ job job-1234 opened · fix the login bug\r\n");
  });

  it("renders an input with its kind and sender", () => {
    const r = renderAgentLine(JSON.stringify({ type: "job_input", job_id: "j1", kind: "answer", sender: "user:u1" }));
    expect(strip(r.text)).toBe("→ job j1 answer from user:u1\r\n");
  });

  it("renders a waiting state with the question", () => {
    const r = renderAgentLine(JSON.stringify({ type: "job_state", job_id: "j1", state: "waiting", message: "Which branch?" }));
    expect(strip(r.text)).toBe("◇ job j1 waiting · Which branch?\r\n");
  });

  it("renders a deliverable and a close", () => {
    expect(strip(renderAgentLine(JSON.stringify({ type: "job_deliverable", job_id: "j1", kind: "merge_request", ref: "!42", url: "https://x/mr/42" })).text))
      .toBe("⇧ job j1 merge_request !42 https://x/mr/42\r\n");
    expect(strip(renderAgentLine(JSON.stringify({ type: "job_closed", job_id: "j1", verdict: "accomplished", score: 0.9 })).text))
      .toBe("── job j1 closed accomplished 0.90 ──\r\n");
  });

  it("renders member status and carries it in the summary", () => {
    const r = renderAgentLine(JSON.stringify({ type: "member_status", state: "busy", jobs_in_flight: 1, cap: 2, claude_version: "2.1.0" }));
    expect(strip(r.text)).toBe("● member busy · 1/2 · claude 2.1.0\r\n");
    expect(r.summary).toEqual({ memberState: "busy", jobsInFlight: 1, cap: 2 });
  });

  it("still renders assistant lines whose message is an object", () => {
    const r = renderAgentLine(JSON.stringify({ type: "assistant", message: { model: "m", content: [{ type: "text", text: "hi" }] } }));
    expect(strip(r.text)).toBe("hi\r\n");
    expect(r.summary).toEqual({ model: "m" });
  });
});
