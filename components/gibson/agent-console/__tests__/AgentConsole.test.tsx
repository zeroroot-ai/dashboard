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
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
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

// next/navigation: the ?run= deep link (dashboard#1147). The mock keeps the
// URL in a variable so router.replace and useSearchParams agree.
let search = "";
const replaceMock = vi.fn((href: string) => {
  const i = href.indexOf("?");
  search = i >= 0 ? href.slice(i + 1) : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/dashboard/sandboxes",
  useSearchParams: () => new URLSearchParams(search),
}));

const useAgentConsoleMock = vi.fn();
vi.mock("@/src/hooks/useAgentConsole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/hooks/useAgentConsole")>()),
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
    missionId: "",
    missionRunId: "",
    sandboxClass: "agent",
    ...over,
  };
}

beforeEach(() => {
  search = "";
  replaceMock.mockClear();
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
    expect(screen.getByText("No sandboxes are running")).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Pop-out (dashboard#1147)
// ---------------------------------------------------------------------------

describe("AgentConsole pop-out", () => {
  function three() {
    useRunningAgentsMock.mockReturnValue({ data: agents(3), isLoading: false, error: null });
  }

  it("opens on click, mirrors the run in the URL, and closes on Escape", async () => {
    three();
    const view = render(<AgentConsole />);
    expect(screen.queryByTestId("agent-popout")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("agent-tile")[1]);
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard/sandboxes?run=run-01",
      { scroll: false },
    );
    view.rerender(<AgentConsole />);
    const popout = await screen.findByTestId("agent-popout");
    expect(popout).toHaveTextContent("agent-1");
    expect(screen.getByTestId("popout-position")).toHaveTextContent("2 / 3");
    expect(screen.getAllByTestId("agent-tile")[1]).toHaveAttribute("data-selected", "true");

    await act(async () => {
      fireEvent.keyDown(popout, { key: "Escape" });
    });
    expect(replaceMock).toHaveBeenLastCalledWith("/dashboard/sandboxes", { scroll: false });
    view.rerender(<AgentConsole />);
    await waitFor(() => expect(screen.queryByTestId("agent-popout")).toBeNull());
  });

  it("opens on Enter and on F from the keyboard", async () => {
    three();
    render(<AgentConsole />);
    const tile = screen.getAllByTestId("agent-tile")[0];
    await act(async () => {
      fireEvent.keyDown(tile, { key: "Enter" });
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard/sandboxes?run=run-00",
      { scroll: false },
    );
    await act(async () => {
      fireEvent.keyDown(screen.getAllByTestId("agent-tile")[2], { key: "f" });
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard/sandboxes?run=run-02",
      { scroll: false },
    );
  });

  it("moves to the previous and the next agent with Left and Right, wrapping", async () => {
    three();
    search = "run=run-02";
    const view = render(<AgentConsole />);
    const popout = await screen.findByTestId("agent-popout");
    expect(screen.getByTestId("popout-position")).toHaveTextContent("3 / 3");
    await act(async () => {
      fireEvent.keyDown(popout, { key: "ArrowRight" });
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard/sandboxes?run=run-00",
      { scroll: false },
    );
    view.rerender(<AgentConsole />);
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("agent-popout"), { key: "ArrowLeft" });
    });
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard/sandboxes?run=run-02",
      { scroll: false },
    );
  });

  it("opens the pop-out for a deep link on load and streams it through the same hook", async () => {
    three();
    search = "run=run-01";
    render(<AgentConsole />);
    const popout = await screen.findByTestId("agent-popout");
    expect(popout).toHaveTextContent("agent-1");
    expect(screen.getByTestId("popout-rail")).toHaveTextContent("run-01");
    // The pop-out attaches to the same run id; the shared registry gives it
    // the tile's stream (see stream.test.ts for the single-EventSource proof).
    const ids = useAgentConsoleMock.mock.calls.map((c) => c[0]);
    expect(ids.filter((id) => id === "run-01").length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a deep link to a run that is not on the wall", () => {
    three();
    search = "run=nope";
    render(<AgentConsole />);
    expect(screen.queryByTestId("agent-popout")).toBeNull();
  });

  it("returns focus to the tile on close", async () => {
    three();
    const view = render(<AgentConsole />);
    const tile = screen.getAllByTestId("agent-tile")[1];
    tile.focus();
    await act(async () => {
      fireEvent.click(tile);
    });
    view.rerender(<AgentConsole />);
    const popout = await screen.findByTestId("agent-popout");
    await waitFor(() => expect(popout.contains(document.activeElement)).toBe(true));
    await act(async () => {
      fireEvent.keyDown(popout, { key: "Escape" });
    });
    view.rerender(<AgentConsole />);
    await waitFor(() => expect(screen.queryByTestId("agent-popout")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByTestId("agent-tile")[1]));
  });
});

// ---------------------------------------------------------------------------
// Finished-run ribbon and recent list (dashboard#1145)
// ---------------------------------------------------------------------------

describe("AgentConsole finished runs", () => {
  it("keeps a run that left the list on the wall with a ribbon for 60 s, then lists it as recent", async () => {
    vi.useFakeTimers();
    try {
      useAgentConsoleMock.mockReturnValue({ phase: "streaming", summary: {} });
      const two = agents(2);
      useRunningAgentsMock.mockReturnValue({ data: two, isLoading: false, error: null });
      const view = render(<AgentConsole />);
      expect(screen.getAllByTestId("agent-tile")).toHaveLength(2);
      expect(screen.queryByTestId("agent-tile-ribbon")).toBeNull();

      // run-00 finishes: its stream reports finished and the list drops it.
      useAgentConsoleMock.mockImplementation((runId: string) =>
        runId === "run-00" ? { phase: "finished", summary: {} } : { phase: "streaming", summary: {} },
      );
      useRunningAgentsMock.mockReturnValue({ data: [two[1]], isLoading: false, error: null });
      await act(async () => {
        view.rerender(<AgentConsole />);
      });
      expect(screen.getAllByTestId("agent-tile")).toHaveLength(2);
      expect(screen.getByTestId("agent-tile-ribbon")).toHaveTextContent("Completed");
      expect(screen.getByTestId("running-count")).toHaveTextContent("1 running");
      expect(screen.queryByTestId("recent-runs")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      expect(screen.getAllByTestId("agent-tile")).toHaveLength(1);
      const recent = screen.getByTestId("recent-runs");
      expect(recent).toHaveTextContent("agent-0");
      expect(recent).toHaveTextContent("Completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a mission and an agent action in the empty state", () => {
    useRunningAgentsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<AgentConsole />);
    expect(screen.getByRole("link", { name: "Launch a mission" })).toHaveAttribute("href", "/dashboard/missions");
    expect(screen.getByRole("link", { name: "Enable an agent" })).toHaveAttribute("href", "/dashboard/agents");
  });
});

// ---------------------------------------------------------------------------
// Copy: sandboxes, not coding agents (dashboard#1158)
// ---------------------------------------------------------------------------

describe("AgentConsole copy", () => {
  it.each([
    ["empty", []],
    ["with runs", [agent({ runId: "run-1", agentName: "claude" })]],
  ])("never says coding agent or console (%s)", (_label, data) => {
    useRunningAgentsMock.mockReturnValue({ data, isLoading: false, error: null });
    render(<AgentConsole />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/coding agent/i);
    expect(text).not.toMatch(/console/i);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agent Sandboxes");
  });
});

// ---------------------------------------------------------------------------
// Sandbox class on the tile (dashboard#1160)
// ---------------------------------------------------------------------------

describe("AgentConsole sandbox class", () => {
  it("shows the class the run was launched under", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [agent({ runId: "run-1", sandboxClass: "gvisor-strict" })],
      isLoading: false,
      error: null,
    });
    render(<AgentConsole />);
    expect(screen.getByTestId("agent-tile-class")).toHaveTextContent("gvisor-strict");
  });

  it("shows no class chip when the daemon reports none", () => {
    useRunningAgentsMock.mockReturnValue({
      data: [agent({ runId: "run-1", sandboxClass: "" })],
      isLoading: false,
      error: null,
    });
    render(<AgentConsole />);
    expect(screen.queryByTestId("agent-tile-class")).toBeNull();
  });
});
