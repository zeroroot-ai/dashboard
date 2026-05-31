import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { DecisionTimeline } from "../DecisionTimeline";
import type { DecisionEntry } from "@/src/types/trace";

// Mock the observation-detail hook so expansion is synchronous + deterministic.
const useObservationDetailMock = vi.fn();
vi.mock("@/src/hooks/useTraces", () => ({
  useObservationDetail: (id: string, enabled: boolean) =>
    useObservationDetailMock(id, enabled),
}));

beforeEach(() => {
  useObservationDetailMock.mockReturnValue({ data: undefined, isLoading: false });
});

function decision(overrides: Partial<DecisionEntry>): DecisionEntry {
  return {
    id: "d1",
    timestamp: new Date("2026-01-01T09:01:00Z"),
    action: "enumerate_subdomains",
    targetAgent: "recon-agent",
    confidence: 0.86,
    reasoning: "Target surface unknown; start with passive DNS.",
    model: "claude-sonnet-4",
    inputTokens: 1200,
    outputTokens: 300,
    latencyMs: 1200,
    status: "ok",
    contentAvailable: true,
    ...overrides,
  };
}

describe("DecisionTimeline", () => {
  it("renders decisions as an agent-centric narrative (no raw ids)", () => {
    render(
      <DecisionTimeline
        decisions={[
          decision({ id: "d1" }),
          decision({
            id: "d2",
            action: "port_scan_top_hosts",
            confidence: 0.79,
            reasoning: "",
            targetAgent: "recon-agent",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Enumerate subdomains/)).toBeInTheDocument();
    expect(screen.getByText(/Port scan top hosts/)).toBeInTheDocument();
    expect(screen.getAllByText("recon-agent").length).toBe(2);
    // confidence surfaced, reasoning surfaced
    expect(screen.getByText(/conf 86%/)).toBeInTheDocument();
    expect(
      screen.getByText(/Target surface unknown/),
    ).toBeInTheDocument();
    // raw observation ids must NOT leak into the default view
    expect(screen.queryByText("d1")).not.toBeInTheDocument();
  });

  it("preserves the order it is given", () => {
    render(
      <DecisionTimeline
        decisions={[
          decision({ id: "a", action: "first_step" }),
          decision({ id: "b", action: "second_step" }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(/First step/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Second step/)).toBeInTheDocument();
  });

  it("expands a step into its conversation", () => {
    useObservationDetailMock.mockReturnValue({
      isLoading: false,
      data: {
        id: "d1",
        contentAvailable: true,
        messages: [{ role: "assistant", content: "Running subfinder now." }],
        metadata: {},
      },
    });

    render(<DecisionTimeline decisions={[decision({ id: "d1" })]} />);

    fireEvent.click(screen.getByRole("button", { name: /show conversation/i }));
    expect(screen.getByText("Running subfinder now.")).toBeInTheDocument();
  });

  it("shows a no-content state when the step recorded no conversation", () => {
    useObservationDetailMock.mockReturnValue({
      isLoading: false,
      data: { id: "d1", contentAvailable: false, messages: [], metadata: {} },
    });

    render(
      <DecisionTimeline
        decisions={[decision({ id: "d1", contentAvailable: false })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /show conversation/i }));
    expect(
      screen.getByText(/No conversation content was recorded/i),
    ).toBeInTheDocument();
  });

  it("points to Advanced when there are no decisions", () => {
    render(<DecisionTimeline decisions={[]} />);
    expect(
      screen.getByText(/No agent decisions were recorded/i),
    ).toBeInTheDocument();
  });
});
