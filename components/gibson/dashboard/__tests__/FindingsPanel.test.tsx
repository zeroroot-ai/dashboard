// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useFindings } = vi.hoisted(() => ({ useFindings: vi.fn() }));
vi.mock("@/src/hooks/useFindings", () => ({ useFindings }));

import { FindingsPanel } from "../FindingsPanel";

function finding(id: string, title: string, severity: string, confidence?: number) {
  return {
    id,
    title,
    severity,
    missionId: "m",
    type: "finding",
    description: "",
    affectedAssets: [],
    discoveredAt: new Date(),
    taxonomy: {},
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function mockData(rows: unknown[], total = rows.length) {
  useFindings.mockReturnValue({
    data: { data: rows, total },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("FindingsPanel", () => {
  it("lists the findings in the order that the API gives, with no sort and no status", () => {
    mockData([
      finding("a", "Low one", "low"),
      finding("b", "Critical one", "critical", 0.9),
      finding("c", "Medium one", "medium"),
    ]);
    render(<FindingsPanel />);
    const rows = screen.getAllByTestId("finding-row");
    expect(rows.map((r) => r.querySelector("a")?.textContent)).toEqual([
      "Low one",
      "Critical one",
      "Medium one",
    ]);
    expect(screen.queryByText(/verified/i, { selector: "[data-testid=finding-row] *" })).toBeNull();
  });

  it("says that the API gives no status, and shows the confidence or unknown", () => {
    mockData([finding("a", "A", "high", 0.5), finding("b", "B", "high")]);
    render(<FindingsPanel />);
    expect(screen.getByTestId("findings-panel-note").textContent).toContain("does not return the status");
    expect(screen.getAllByTestId("finding-row-confidence").map((e) => e.textContent)).toEqual([
      "Confidence: 50%",
      "Confidence: unknown",
    ]);
  });

  it("links each finding to its detail page", () => {
    mockData([finding("a/b", "A", "high")]);
    render(<FindingsPanel />);
    expect(screen.getByRole("link", { name: "A" }).getAttribute("href")).toBe("/dashboard/findings/a%2Fb");
  });

  it("links each finding to the graph with the finding selected", () => {
    mockData([finding("a/b", "A", "high")]);
    render(<FindingsPanel />);
    expect(screen.getByTestId("finding-attack-path").getAttribute("href")).toBe(
      "/dashboard/graph?finding=a%2Fb",
    );
  });

  it("shows how many findings the list leaves out", () => {
    mockData([finding("a", "A", "high")], 25);
    render(<FindingsPanel />);
    expect(screen.getByText("Showing 1 of 25 findings.")).toBeInTheDocument();
  });

  it("shows an empty text, and an error with no list", () => {
    mockData([]);
    const { unmount } = render(<FindingsPanel />);
    expect(screen.getByText("No findings yet.")).toBeInTheDocument();
    unmount();
    useFindings.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<FindingsPanel />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryAllByTestId("finding-row")).toHaveLength(0);
  });
});
