/**
 * First-class placement (dashboard#1145): the sidebar live count, the
 * console links from the mission and agents pages, and the pop-out's
 * mission actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { RunningAgentsBadge } from "../RunningAgentsBadge";
import { LiveConsoleLink } from "../LiveConsoleLink";
import { findLiveRun, consoleHref } from "../useLiveRun";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

const useRunningAgentsMock = vi.fn();
vi.mock("@/src/hooks/useRunningAgents", () => ({
  useRunningAgents: () => useRunningAgentsMock(),
}));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuBadge: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <span {...rest}>{children}</span>
  ),
}));

function run(over: Partial<RunningAgentView>): RunningAgentView {
  return {
    runId: "run-1",
    agentName: "claude",
    sandboxId: "sbx",
    startedAt: "2026-08-30T10:00:00Z",
    missionId: "m-1",
    missionRunId: "mr-1",
    ...over,
  };
}

beforeEach(() => {
  useRunningAgentsMock.mockReset();
});

describe("RunningAgentsBadge", () => {
  it("shows the live count and hides at zero", () => {
    useRunningAgentsMock.mockReturnValue({ data: [run({}), run({ runId: "run-2" })] });
    const view = render(<RunningAgentsBadge />);
    expect(screen.getByTestId("running-agents-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("running-agents-badge")).toHaveAccessibleName("2 agents running");
    view.unmount();
    useRunningAgentsMock.mockReturnValue({ data: [] });
    render(<RunningAgentsBadge />);
    expect(screen.queryByTestId("running-agents-badge")).toBeNull();
  });
});

describe("findLiveRun and consoleHref", () => {
  const runs = [run({ runId: "run-1", missionId: "m-1", agentName: "claude" }), run({ runId: "run-2", missionId: "m-2", agentName: "zerocool" })];
  it("matches by mission id or agent name and ignores empties", () => {
    expect(findLiveRun(runs, { missionId: "m-2" })?.runId).toBe("run-2");
    expect(findLiveRun(runs, { agentName: "claude" })?.runId).toBe("run-1");
    expect(findLiveRun(runs, { missionId: "" })).toBeUndefined();
    expect(findLiveRun(runs, { agentName: "" })).toBeUndefined();
    expect(findLiveRun(undefined, { missionId: "m-1" })).toBeUndefined();
    expect(consoleHref("run 1")).toBe("/dashboard/agents/console?run=run%201");
  });
});

describe("LiveConsoleLink", () => {
  it("links to the run's pane while the mission has a live run", () => {
    useRunningAgentsMock.mockReturnValue({ data: [run({ runId: "run-9", missionId: "m-9" })] });
    render(<LiveConsoleLink match={{ missionId: "m-9" }} />);
    const link = screen.getByTestId("live-console-link");
    expect(link).toHaveAttribute("href", "/dashboard/agents/console?run=run-9");
    expect(link).toHaveTextContent("Live console");
  });

  it("renders nothing when no run matches", () => {
    useRunningAgentsMock.mockReturnValue({ data: [run({ missionId: "m-1" })] });
    render(<LiveConsoleLink match={{ agentName: "nobody" }} />);
    expect(screen.queryByTestId("live-console-link")).toBeNull();
  });
});
