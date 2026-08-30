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
import { render, screen, act, waitFor } from "@testing-library/react";
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
  useAgentConsoleMock.mockReturnValue({ phase: "streaming", summary: {} });
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

    const panes = screen.getAllByTestId("agent-tile");
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

  it("shows the tile header with the short run id, elapsed time and stream facts (#1144)", () => {
    useAgentConsoleMock.mockReturnValue({
      phase: "streaming",
      summary: { model: "claude-opus-5", turns: 3, costUsd: 0.13 },
    });
    useRunningAgentsMock.mockReturnValue({
      data: [agent({ runId: "0123456789abcdef", agentName: "claude" })],
      isLoading: false,
      error: null,
    });
    render(<AgentConsole />);
    const header = screen.getByTestId("agent-tile-header");
    expect(header).toHaveTextContent("claude");
    expect(header).toHaveTextContent("01234567");
    expect(header).toHaveTextContent(/\d+s/);
    expect(header).toHaveTextContent("3t");
    expect(header).toHaveTextContent("$0.13");
    expect(screen.getByTestId("agent-tile-dot")).toHaveAccessibleName("live");
  });

  it("marks a finished stream and hides facts it does not have", () => {
    useAgentConsoleMock.mockReturnValue({ phase: "finished", summary: {} });
    useRunningAgentsMock.mockReturnValue({
      data: [agent({})],
      isLoading: false,
      error: null,
    });
    render(<AgentConsole />);
    expect(screen.getByTestId("agent-tile-dot")).toHaveAccessibleName("finished");
    expect(screen.getByTestId("agent-tile")).toHaveAttribute("data-phase", "finished");
    expect(screen.getByTestId("agent-tile-header")).not.toHaveTextContent("$");
  });
});

// ---------------------------------------------------------------------------
// Ops wall (dashboard#1146)
// ---------------------------------------------------------------------------

function agents(n: number): RunningAgentView[] {
  return Array.from({ length: n }, (_, i) =>
    agent({
      runId: `run-${String(i).padStart(2, "0")}`,
      agentName: `agent-${i}`,
      startedAt: new Date(Date.UTC(2026, 7, 30, 10, i)).toISOString(),
    }),
  );
}

describe("AgentConsole wall", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    [1, 1],
    [4, 2],
    [12, 5],
    [25, 5],
    [26, 6],
  ])("fits %i agents into %i columns", (count, columns) => {
    useRunningAgentsMock.mockReturnValue({ data: agents(count), isLoading: false, error: null });
    render(<AgentConsole />);
    const wall = screen.getByTestId("agent-wall");
    expect(wall).toHaveAttribute("data-columns", String(columns));
    expect(wall.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`);
    expect(screen.getAllByTestId("agent-tile")).toHaveLength(count);
  });

  it("streams every tile independently, once per run id", () => {
    useRunningAgentsMock.mockReturnValue({ data: agents(25), isLoading: false, error: null });
    render(<AgentConsole />);
    const ids = useAgentConsoleMock.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(25);
  });

  it("switches density, persists it, and reads it back on reload", async () => {
    useRunningAgentsMock.mockReturnValue({ data: agents(4), isLoading: false, error: null });
    const first = render(<AgentConsole />);
    expect(screen.getByTestId("agent-wall")).toHaveAttribute("data-density", "comfortable");
    await act(async () => {
      screen.getByTestId("density-compact").click();
    });
    expect(screen.getByTestId("agent-wall")).toHaveAttribute("data-density", "compact");
    expect(screen.getByTestId("density-compact")).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("agent-console.density")).toBe("compact");
    first.unmount();

    render(<AgentConsole />);
    await waitFor(() =>
      expect(screen.getByTestId("agent-wall")).toHaveAttribute("data-density", "compact"),
    );
  });

  it("reads a persisted sort and orders the tiles by it", async () => {
    localStorage.setItem("agent-console.sort", "name");
    useRunningAgentsMock.mockReturnValue({
      data: [
        agent({ runId: "r-1", agentName: "zerocool", startedAt: "2026-08-30T10:00:00Z" }),
        agent({ runId: "r-2", agentName: "claude", startedAt: "2026-08-30T10:05:00Z" }),
      ],
      isLoading: false,
      error: null,
    });
    render(<AgentConsole />);
    await waitFor(() => expect(screen.getByTestId("sort-select")).toHaveTextContent("Name"));
    const order = screen.getAllByTestId("agent-tile").map((t) => t.getAttribute("data-run-id"));
    expect(order).toEqual(["r-2", "r-1"]);
  });

  it("ignores a bogus stored choice", async () => {
    localStorage.setItem("agent-console.density", "huge");
    useRunningAgentsMock.mockReturnValue({ data: agents(2), isLoading: false, error: null });
    render(<AgentConsole />);
    await waitFor(() =>
      expect(screen.getByTestId("agent-wall")).toHaveAttribute("data-density", "comfortable"),
    );
  });
});
