import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RunsList } from "../RunsList";
import type { LlmRun } from "@/src/types/trace";

function run(over: Partial<LlmRun> & { id: string }): LlmRun {
  return {
    label: over.id || "Ungrouped calls",
    models: ["claude-opus-4"],
    callCount: 1,
    promptTokens: 60,
    completionTokens: 40,
    totalTokens: 100,
    estimatedCostUsd: 0,
    calls: [],
    ...over,
  };
}

describe("RunsList", () => {
  it("links a run to its run view", () => {
    render(<RunsList runs={[run({ id: "run-1", label: "recon-scan" })]} />);
    const link = screen.getByRole("link", { name: /recon-scan/ });
    expect(link.getAttribute("href")).toBe("/dashboard/traces/run-1");
  });

  it("routes the ungrouped run to the URL-safe '_' segment", () => {
    render(<RunsList runs={[run({ id: "", label: "Ungrouped calls" })]} />);
    const link = screen.getByRole("link", { name: /Ungrouped calls/ });
    expect(link.getAttribute("href")).toBe("/dashboard/traces/_");
  });

  it("shows the single model name when one model was used", () => {
    render(<RunsList runs={[run({ id: "run-1", models: ["gpt-4o"] })]} />);
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("summarises a multi-model run as a count", () => {
    render(
      <RunsList runs={[run({ id: "run-1", models: ["gpt-4o", "claude-opus-4"] })]} />,
    );
    expect(screen.getByText("2 models")).toBeInTheDocument();
  });
});
