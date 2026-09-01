/**
 * Fan-out through the real hook and registry (dashboard#1148): with 25
 * running agents, every tile in view, the page never holds more than the
 * cap of open EventSources, and the header says how many wait.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { AgentConsole } from "../AgentConsole";
import { DEFAULT_STREAM_CAP } from "@/src/lib/agent-console/stream";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = React.forwardRef<unknown, { title?: string }>(function MockTerminal({ title }) {
      return <div data-testid="mock-terminal">{title}</div>;
    });
    return Stub;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/sandboxes",
  useSearchParams: () => new URLSearchParams(""),
}));
// Bank members on the wall (gibson#1706): none in these suites.
vi.mock("@/src/hooks/useMemberRuns", () => ({ useMemberRuns: () => new Map() }));

const useRunningAgentsMock = vi.fn();
vi.mock("@/src/hooks/useRunningAgents", () => ({
  useRunningAgents: () => useRunningAgentsMock(),
}));

class FakeEventSource {
  static open = new Set<FakeEventSource>();
  static urls: string[] = [];
  constructor(public url: string) {
    FakeEventSource.open.add(this);
    FakeEventSource.urls.push(url);
  }
  addEventListener() {}
  close() {
    FakeEventSource.open.delete(this);
  }
}

function agents(n: number): RunningAgentView[] {
  return Array.from({ length: n }, (_, i) => ({
    runId: `run-${String(i).padStart(2, "0")}`,
    agentName: `agent-${i}`,
    sandboxId: "",
    startedAt: new Date(Date.UTC(2026, 7, 30, 10, i)).toISOString(),
    missionId: "",
    missionRunId: "",
    sandboxClass: "agent",
    componentKind: "agent",
  }));
}

beforeEach(() => {
  FakeEventSource.open.clear();
  FakeEventSource.urls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = FakeEventSource;
  useRunningAgentsMock.mockReturnValue({ data: agents(25), isLoading: false, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentConsole fan-out", () => {
  it("holds at most the cap of open streams for 25 tiles and shows the queue", async () => {
    const view = render(<AgentConsole />);
    await waitFor(() => expect(FakeEventSource.open.size).toBe(DEFAULT_STREAM_CAP));
    expect(FakeEventSource.urls).toHaveLength(DEFAULT_STREAM_CAP);
    await waitFor(() =>
      expect(screen.getByTestId("stream-stats")).toHaveTextContent(
        `live ${DEFAULT_STREAM_CAP}/${DEFAULT_STREAM_CAP} · ${25 - DEFAULT_STREAM_CAP} waiting`,
      ),
    );
    view.unmount();
    expect(FakeEventSource.open.size).toBe(0);
  });
});
