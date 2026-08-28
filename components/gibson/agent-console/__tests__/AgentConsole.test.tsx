/**
 * AgentConsole component tests (ADR-0016 S12, dashboard#1134).
 *
 * Covers the two hard requirements:
 *   1. Show them all: every running agent gets its own pane, and each pane
 *      opens its own live stream (useAgentConsole called once per run id).
 *   2. Read-only: the console renders no input, textarea, or other write
 *      control, and no PTY.
 * Plus the empty and error states.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";

import { AgentConsole } from "../AgentConsole";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

// next/dynamic loads the xterm terminal client-side only; stub it with an
// input-free placeholder so the test does not touch the DOM terminal.
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = React.forwardRef<unknown, { title?: string }>(
      function MockTerminal({ title }, _ref) {
        return <div data-testid="mock-terminal">{title}</div>;
      },
    );
    return Stub;
  },
}));

const useAgentConsoleMock = vi.fn();
vi.mock("@/src/hooks/useAgentConsole", () => ({
  useAgentConsole: (runId: string | undefined) => useAgentConsoleMock(runId),
}));

const useRunningAgentsMock = vi.fn();
vi.mock("@/src/hooks/useRunningAgents", () => ({
  useRunningAgents: () => useRunningAgentsMock(),
}));

function agent(over: Partial<RunningAgentView>): RunningAgentView {
  return {
    runId: "run-1",
    agentName: "scanner",
    sandboxId: "sbx-1",
    startedAt: "2026-08-28T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  useAgentConsoleMock.mockReset();
  useRunningAgentsMock.mockReset();
});

describe("AgentConsole", () => {
  it("renders a pane for every running agent (requirement 1: show them all)", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [
        agent({ runId: "run-1", agentName: "scanner" }),
        agent({ runId: "run-2", agentName: "fuzzer" }),
        agent({ runId: "run-3", agentName: "probe" }),
      ],
      isLoading: false,
      error: null,
    });

    render(<AgentConsole />);

    const panes = screen.getAllByTestId("agent-console-pane");
    expect(panes).toHaveLength(3);
    expect(screen.getByText("scanner")).toBeInTheDocument();
    expect(screen.getByText("fuzzer")).toBeInTheDocument();
    expect(screen.getByText("probe")).toBeInTheDocument();
    expect(screen.getByTestId("running-count")).toHaveTextContent("3 running");
  });

  it("opens an independent stream for each run id", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [agent({ runId: "run-1" }), agent({ runId: "run-2" })],
      isLoading: false,
      error: null,
    });

    render(<AgentConsole />);

    const calledRunIds = useAgentConsoleMock.mock.calls.map((c) => c[0]);
    expect(calledRunIds).toContain("run-1");
    expect(calledRunIds).toContain("run-2");
  });

  it("renders no input, textarea, or other write control (requirement 2: read-only)", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [agent({ runId: "run-1" }), agent({ runId: "run-2" })],
      isLoading: false,
      error: null,
    });

    const { container } = render(<AgentConsole />);

    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the empty state when no agents are running", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<AgentConsole />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No agents are running")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-console-pane")).not.toBeInTheDocument();
  });

  it("shows an error alert when the list fails to load", () => {
    useRunningAgentsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    });

    render(<AgentConsole />);

    expect(screen.getByText("Could not load running agents")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-console-pane")).not.toBeInTheDocument();
  });
});
