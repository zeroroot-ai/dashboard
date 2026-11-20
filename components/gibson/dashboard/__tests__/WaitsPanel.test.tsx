// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { useDestructiveActions } = vi.hoisted(() => ({ useDestructiveActions: vi.fn() }));
vi.mock("@/src/hooks/useDestructiveActions", () => ({ useDestructiveActions }));

import { WaitsPanel } from "../WaitsPanel";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function mockQueue(items: unknown[], extra: Record<string, unknown> = {}) {
  useDestructiveActions.mockReturnValue({
    data: { items },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  });
}

function item(id: string, requestedAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    missionId: "m",
    scopeId: "s",
    hypothesisId: "h",
    technique: `tech-${id}`,
    predicateType: "p",
    blastRadius: "",
    reversibility: "unspecified",
    requestedAt,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WaitsPanel", () => {
  it("shows the count, the age of the oldest item and the longest wait first", () => {
    mockQueue([
      item("new", "2026-11-20T11:00:00.000Z"),
      item("old", "2026-11-19T10:00:00.000Z", { blastRadius: "one host", reversibility: "irreversible" }),
    ]);
    render(<WaitsPanel />);
    const summary = screen.getByTestId("waits-summary");
    expect(summary.textContent).toContain("2 items wait");
    expect(summary.textContent).toContain("Oldest: 1 d 2 h");
    const rows = screen.getAllByTestId("wait-row");
    expect(within(rows[0]).getByText("tech-old")).toBeInTheDocument();
    expect(within(rows[1]).getByText("tech-new")).toBeInTheDocument();
  });

  it("shows the blast radius and the reversibility of a destructive action, and one link", () => {
    mockQueue([item("a", "2026-11-20T11:00:00.000Z", { blastRadius: "one host", reversibility: "irreversible" })]);
    render(<WaitsPanel />);
    expect(screen.getByTestId("wait-detail").textContent).toBe("Blast radius: one host. Irreversible.");
    expect(screen.getByTestId("wait-age").textContent).toBe("Waiting: 1 h");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/dashboard/destructive-actions");
  });

  it("says not stated and not classified when the daemon gives no signal", () => {
    mockQueue([item("a", "2026-11-20T11:55:00.000Z")]);
    render(<WaitsPanel />);
    expect(screen.getByTestId("wait-detail").textContent).toBe(
      "Blast radius: not stated. Reversibility not classified.",
    );
  });

  it("shows an unknown wait, never zero, when the request time is missing", () => {
    mockQueue([item("a", "")]);
    render(<WaitsPanel />);
    expect(screen.getByTestId("wait-age").textContent).toBe("Waiting: unknown");
    expect(screen.getByTestId("waits-summary").textContent).toContain("Oldest: unknown");
  });

  it("shows an empty state and the note about the three kinds with no source", () => {
    mockQueue([]);
    render(<WaitsPanel />);
    expect(screen.getByText("Nothing waits on a person.")).toBeInTheDocument();
    expect(screen.getByTestId("waits-summary").textContent).toBe("0 items wait");
    expect(screen.getByTestId("waits-missing-kinds").textContent).toContain("not available yet");
  });

  it("shows an error and no count when the queue fails to load", () => {
    useDestructiveActions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: vi.fn(),
    });
    render(<WaitsPanel />);
    expect(screen.queryByTestId("waits-summary")).toBeNull();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
