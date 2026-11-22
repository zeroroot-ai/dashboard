// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useFindingActivity } = vi.hoisted(() => ({ useFindingActivity: vi.fn() }));
vi.mock("@/src/hooks/useFindingActivity", () => ({ useFindingActivity }));

import { ActivityStrip } from "../ActivityStrip";

function mock(over: Record<string, unknown> = {}) {
  useFindingActivity.mockReturnValue({
    data: {
      events: [
        { seq: 3, kind: "finding.raised", time: "2026-11-20T10:00:00.000Z", label: "Raised" },
        { seq: 9, kind: "finding.status_changed", time: "", label: "Status changed: verified" },
      ],
      truncated: false,
      exposure: { found: true, verified: true, totalSeconds: 7200, waitSeconds: 1800, agentSeconds: 5400 },
      ...over,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("ActivityStrip", () => {
  it("shows each event with its time and a link to its replay frame", () => {
    mock();
    render(<ActivityStrip findingId="f1" />);
    expect(screen.getAllByTestId("activity-event")).toHaveLength(2);
    expect(screen.getAllByTestId("activity-event-replay").map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/world?seq=3",
      "/dashboard/world?seq=9",
    ]);
    expect(screen.getAllByTestId("activity-event-time")[1].textContent).toBe("time unknown");
  });

  it("shows the window split into agent time and wait time", () => {
    mock();
    render(<ActivityStrip findingId="f1" />);
    const t = screen.getByTestId("activity-exposure").textContent ?? "";
    expect(t).toContain("Exposure window: 2 h");
    expect(t).toContain("Agent time: 1 h 30 min");
    expect(t).toContain("Wait time: 30 min");
  });

  it("says so when the Timeline holds nothing for the finding, with no zero", () => {
    mock({ events: [], exposure: { found: false, verified: false, totalSeconds: 0, waitSeconds: 0, agentSeconds: 0 } });
    render(<ActivityStrip findingId="f1" />);
    expect(screen.getByTestId("activity-empty")).toBeInTheDocument();
    expect(screen.getByTestId("activity-no-exposure")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-exposure")).toBeNull();
  });

  it("notes a truncated read and shows an error", () => {
    mock({ truncated: true });
    const { unmount } = render(<ActivityStrip findingId="f1" />);
    expect(screen.getByTestId("activity-truncated")).toBeInTheDocument();
    unmount();
    useFindingActivity.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<ActivityStrip findingId="f1" />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
