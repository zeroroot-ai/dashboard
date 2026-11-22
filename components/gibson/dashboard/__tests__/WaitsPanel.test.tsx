// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { useWaitItems } = vi.hoisted(() => ({ useWaitItems: vi.fn() }));
vi.mock("@/src/hooks/useWaitItems", () => ({ useWaitItems }));

import { WaitsPanel } from "../WaitsPanel";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function mockQueue(items: unknown[], extra: Record<string, unknown> = {}) {
  useWaitItems.mockReturnValue({ items, isLoading: false, error: null, refetch: vi.fn(), ...extra });
}

function item(id: string, requestedAt: string, over: Record<string, unknown> = {}) {
  // The daemon counts the wait. The test derives it from a start time for readability.
  const waitedMs = new Date(NOW).getTime() - new Date(requestedAt).getTime();
  return {
    kind: "destructive-action",
    id: `destructive-action:${id}`,
    title: `tech-${id}`,
    waitedMs,
    href: "/dashboard/destructive-actions",
    blastRadius: "",
    reversibility: "unspecified",
    ...over,
  };
}

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

  it("shows the wait that the daemon counts, not the time of the browser", () => {
    mockQueue([item("a", "2026-11-20T11:00:00.000Z", { waitedMs: 5 * 60_000 })]);
    render(<WaitsPanel />);
    expect(screen.getByTestId("wait-age").textContent).toBe("Waiting: 5 min");
  });

  it("shows the four kinds, each with its wait and one link", () => {
    const kinds = ["destructive-action", "merge-refused", "awaiting-scan", "no-health-signal"];
    mockQueue(
      kinds.map((kind, i) =>
        item(String(i), "2026-11-20T11:00:00.000Z", {
          kind,
          href: kind === "destructive-action" ? "/dashboard/destructive-actions" : `/dashboard/findings/f${i}`,
        }),
      ),
    );
    render(<WaitsPanel />);
    const rows = screen.getAllByTestId("wait-row");
    expect(rows.map((r) => r.getAttribute("data-kind")).sort()).toEqual([...kinds].sort());
    for (const row of rows) {
      expect(within(row).getByTestId("wait-age").textContent).toBe("Waiting: 1 h");
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    }
    expect(screen.getByTestId("waits-summary").textContent).toContain("4 items wait");
  });

  it("shows an empty state", () => {
    mockQueue([]);
    render(<WaitsPanel />);
    expect(screen.getByText("Nothing waits on a person.")).toBeInTheDocument();
    expect(screen.getByTestId("waits-summary").textContent).toBe("0 items wait");
  });

  it("shows an error and no count when the queue fails to load", () => {
    mockQueue([], { error: new Error("boom") });
    render(<WaitsPanel />);
    expect(screen.queryByTestId("waits-summary")).toBeNull();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
