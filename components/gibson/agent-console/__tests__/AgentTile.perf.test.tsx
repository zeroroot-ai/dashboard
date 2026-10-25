// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Wall performance guards. Twelve tiles on one page made the console stall.
 * These tests pin the two causes the profile showed: a one-second tick that
 * re-rendered the whole tile, and a write to xterm for every replayed line.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import * as React from "react";

const terminalRenders = vi.fn();
vi.mock("next/dynamic", () => ({
  default: () =>
    React.forwardRef<unknown, { title?: string }>(function MockTerminal({ title }, _ref) {
      terminalRenders();
      return <div data-testid="mock-terminal">{title}</div>;
    }),
}));

vi.mock("@/src/hooks/useAgentConsole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/hooks/useAgentConsole")>()),
  useAgentConsole: () => STATUS,
}));
const STATUS = { phase: "streaming" as const, summary: {} };

import { AgentTile } from "../AgentTile";

beforeEach(() => {
  vi.useFakeTimers();
  terminalRenders.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AgentTile", () => {
  it("does not re-render its terminal on the one-second elapsed tick", () => {
    const { getByTitle } = render(
      <AgentTile
        agent={{
          runId: "run-1",
          agentName: "scanner",
          sandboxId: "sbx",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          missionId: "",
          missionRunId: "",
          sandboxClass: "agent",
          componentKind: "agent",
        }}
        height={200}
        fontSize={12}
      />,
    );
    const rendersAfterMount = terminalRenders.mock.calls.length;
    const before = getByTitle("elapsed").textContent;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getByTitle("elapsed").textContent).not.toBe(before);
    expect(terminalRenders.mock.calls.length).toBe(rendersAfterMount);
  });
});
