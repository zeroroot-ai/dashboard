// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { useFindings } = vi.hoisted(() => ({ useFindings: vi.fn() }));
vi.mock("@/src/hooks/useFindings", () => ({ useFindings }));
vi.mock("@/src/lib/session-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/src/hooks/useUserRefs", () => ({ useUserRefs: () => ({ data: undefined }) }));
vi.mock("@/components/gibson/missions/NewMissionButton", () => ({
  NewMissionButton: () => null,
}));
vi.mock("../FindingsExportDialog", () => ({ FindingsExportDialog: () => null }));

import { FindingsContent } from "../FindingsContent";

function finding(id: string, title: string, confidence?: number, over: Record<string, unknown> = {}) {
  return {
    id,
    missionId: "m1",
    type: "finding",
    severity: "high",
    title,
    description: "",
    affectedAssets: [],
    discoveredAt: new Date(),
    taxonomy: {},
    ...(confidence === undefined ? {} : { confidence }),
    ...over,
  };
}

function mockFindings(rows: ReturnType<typeof finding>[]) {
  useFindings.mockReturnValue({
    data: { data: rows, total: rows.length },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function titles(): string[] {
  const rows = screen.getAllByRole("row").slice(1);
  return rows.map((r) => within(r).getAllByRole("link")[0].textContent ?? "");
}

describe("FindingsContent, the status, the place, the priority and the merge request", () => {
  it("shows the status, the priority, the place and the link of each finding, and unknown for a missing value", () => {
    mockFindings([
      finding("a", "A", 0.5, {
        status: "fixing",
        priority: "P1",
        priorityRule: "internet-facing",
        affectedAssets: ["billing-api"],
        mergeRequestUrl: "https://git.example/mr/1",
      }),
      finding("b", "B", undefined, { affectedAssets: undefined }),
    ]);
    render(<FindingsContent docsHref="https://docs.example" />);
    expect(screen.getAllByTestId("finding-status").map((c) => c.textContent)).toEqual(["fixing", "unknown"]);
    expect(screen.getAllByTestId("finding-priority").map((c) => c.textContent)).toEqual(["P1", "none"]);
    expect(screen.getByText("billing-api")).toBeInTheDocument();
    const links = screen.getAllByTestId("finding-merge-request");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://git.example/mr/1");
  });
});

describe("FindingsContent, the confidence column", () => {
  it("shows the confidence of each finding and unknown when the value is missing", () => {
    mockFindings([finding("a", "A", 0.85), finding("b", "B")]);
    render(<FindingsContent docsHref="https://docs.example" />);
    expect(screen.getByRole("columnheader", { name: /Confidence/ })).toBeInTheDocument();
    const cells = screen.getAllByTestId("finding-confidence").map((c) => c.textContent);
    expect(cells).toEqual(["85%", "unknown"]);
  });

  it("sorts by the column and keeps unknown values last", async () => {
    mockFindings([finding("a", "A", 0.2), finding("b", "B"), finding("c", "C", 0.9)]);
    render(<FindingsContent docsHref="https://docs.example" />);
    const header = screen.getByRole("columnheader", { name: /Confidence/ });
    await userEvent.click(header);
    expect(titles()).toEqual(["A", "C", "B"]);
    await userEvent.click(header);
    expect(titles()).toEqual(["C", "A", "B"]);
  });
});
