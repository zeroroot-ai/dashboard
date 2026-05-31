import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RunsList } from "../RunsList";
import type { TraceRun } from "@/src/lib/trace-runs";
import type { TraceSummary } from "@/src/types/trace";

function trace(id: string): TraceSummary {
  return {
    id,
    name: id,
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    totalTokens: 100,
    promptTokens: 60,
    completionTokens: 40,
    latencyMs: 0,
    tags: [],
  };
}

function run(over: Partial<TraceRun> & { id: string }): TraceRun {
  return {
    label: over.id,
    isSession: false,
    agents: [],
    totalTokens: 100,
    status: "ok",
    latestTimestamp: "2026-01-01T00:00:00Z",
    traces: [trace(over.id)],
    ...over,
  };
}

describe("RunsList", () => {
  it("links a singleton run straight to its run view", () => {
    render(<RunsList runs={[run({ id: "solo", label: "recon-scan" })]} />);
    const link = screen.getByRole("link", { name: /recon-scan/ });
    expect(link.getAttribute("href")).toBe("/dashboard/traces/solo");
  });

  it("expands a multi-trace session to its traces", () => {
    const r = run({
      id: "m1",
      label: "m1",
      isSession: true,
      agents: ["recon", "exploit"],
      traces: [trace("t1"), trace("t2")],
    });
    render(<RunsList runs={[r]} />);

    // collapsed: child trace links not shown yet
    expect(screen.queryByRole("link", { name: /t1/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /m1/ }));

    // child trace links use a name regex since the accessible name also
    // includes the token/timestamp/status text in the row.
    const t1 = screen.getByRole("link", { name: /t1/ });
    expect(t1.getAttribute("href")).toBe("/dashboard/traces/t1");
    expect(screen.getByRole("link", { name: /t2/ }).getAttribute("href")).toBe(
      "/dashboard/traces/t2",
    );
  });

  it("surfaces error status on a run", () => {
    render(<RunsList runs={[run({ id: "bad", status: "error" })]} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});
