// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useOpenFindings } = vi.hoisted(() => ({ useOpenFindings: vi.fn() }));
vi.mock("@/src/hooks/useOpenFindings", () => ({ useOpenFindings }));

import { FindingsPanel } from "../FindingsPanel";

function finding(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title,
    severity: "high",
    status: "open",
    priority: undefined,
    priorityRule: "",
    confidence: undefined,
    mergeRequestUrl: "",
    mergeRequest: "",
    places: [],
    address: "",
    ...over,
  };
}

function mockData(rows: unknown[], nextCursor?: string) {
  useOpenFindings.mockReturnValue({
    data: { findings: rows, nextCursor },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("FindingsPanel", () => {
  it("lists the findings in the rank order that the API gives, with no sort", () => {
    mockData([finding("a", "Low one"), finding("b", "Critical one"), finding("c", "Medium one")]);
    render(<FindingsPanel />);
    const rows = screen.getAllByTestId("finding-row");
    expect(rows.map((r) => r.querySelector("a")?.textContent)).toEqual([
      "Low one",
      "Critical one",
      "Medium one",
    ]);
  });

  it("shows the status, the priority with its rule and the place", () => {
    mockData([
      finding("a", "A", {
        status: "fixing",
        priority: "P1",
        priorityRule: "internet-facing",
        places: [{ label: "billing-api", key: "app:1" }],
      }),
      finding("b", "B", { status: undefined }),
    ]);
    render(<FindingsPanel />);
    expect(screen.getAllByTestId("finding-row-status").map((e) => e.textContent)).toEqual(["fixing", "unknown"]);
    expect(screen.getAllByTestId("finding-row-priority").map((e) => e.textContent)).toEqual(["P1", "no priority"]);
    const details = screen.getAllByTestId("finding-row-detail").map((e) => e.textContent);
    expect(details[0]).toContain("Place: billing-api");
    expect(details[0]).toContain("Rule: internet-facing");
    expect(details[1]).toContain("Place: unknown");
  });

  it("shows the confidence or unknown", () => {
    mockData([finding("a", "A", { confidence: 0.5 }), finding("b", "B")]);
    render(<FindingsPanel />);
    expect(screen.getAllByTestId("finding-row-confidence").map((e) => e.textContent)).toEqual([
      "Confidence: 50%",
      "Confidence: unknown",
    ]);
  });

  it("links a finding with a merge request to it, and shows no link for another", () => {
    mockData([finding("a", "A", { mergeRequestUrl: "https://git.example/mr/1" }), finding("b", "B")]);
    render(<FindingsPanel />);
    const links = screen.getAllByTestId("finding-merge-request");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://git.example/mr/1");
  });

  it("links each finding to its detail page and to the graph", () => {
    mockData([finding("a/b", "A")]);
    render(<FindingsPanel />);
    expect(screen.getByRole("link", { name: "A" }).getAttribute("href")).toBe("/dashboard/findings/a%2Fb");
    expect(screen.getByTestId("finding-attack-path").getAttribute("href")).toBe(
      "/dashboard/graph?finding=a%2Fb",
    );
  });

  it("says that more findings follow when the API has a next page", () => {
    mockData([finding("a", "A")], "tok");
    render(<FindingsPanel />);
    expect(screen.getByTestId("findings-panel-more").textContent).toBe("Showing the first 1 findings.");
  });

  it("shows an empty text, and an error with no list", () => {
    mockData([]);
    const { unmount } = render(<FindingsPanel />);
    expect(screen.getByText("No findings yet.")).toBeInTheDocument();
    unmount();
    useOpenFindings.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<FindingsPanel />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryAllByTestId("finding-row")).toHaveLength(0);
  });
});
