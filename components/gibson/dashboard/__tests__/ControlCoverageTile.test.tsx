// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockPacks, mockCoverage, mockAuthorize } = vi.hoisted(() => ({
  mockPacks: vi.fn(),
  mockCoverage: vi.fn(),
  mockAuthorize: vi.fn(),
}));
vi.mock("@/app/actions/compliance", () => ({
  listCompliancePacksAction: mockPacks,
  getControlCoverageAction: mockCoverage,
}));
vi.mock("@/src/lib/auth/use-authorize", () => ({ useAuthorize: mockAuthorize }));

import { ControlCoverageTile } from "../ControlCoverageTile";

function renderTile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ControlCoverageTile />
    </QueryClientProvider>,
  );
}

const CONTROLS = [
  { controlId: "AC-2", title: "t", family: "AC", familyTitle: "Access", state: "has_evidence", eventCount: 3, lastEventTime: "2026-11-01T12:00:00.000Z" },
  { controlId: "AC-7", title: "t", family: "AC", familyTitle: "Access", state: "no_events", eventCount: 0, lastEventTime: "" },
  { controlId: "AU-2", title: "t", family: "AU", familyTitle: "Audit", state: "no_rule", eventCount: 0, lastEventTime: "" },
];

beforeEach(() => {
  mockPacks.mockReset();
  mockCoverage.mockReset();
  mockAuthorize.mockReset();
  mockAuthorize.mockReturnValue({ allowed: true, loading: false });
});

describe("ControlCoverageTile", () => {
  it("shows the counts, the last evidence date and a link to the Compliance page", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: ["nist-800-53-r5"] });
    mockCoverage.mockResolvedValue({
      ok: true,
      data: { pack: "nist-800-53-r5", controlsWithRule: 2, controlsTotal: 3, controls: CONTROLS },
    });
    renderTile();
    await waitFor(() => expect(screen.getByTestId("control-coverage-with")).toBeInTheDocument());
    expect(screen.getByTestId("control-coverage-with").textContent).toBe("1 control has evidence");
    expect(screen.getByTestId("control-coverage-without").textContent).toBe("2 controls have no evidence");
    expect(screen.getByTestId("control-coverage-last").textContent).toContain("Last evidence:");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/dashboard/compliance");
  });

  it("says there is no evidence when no control has an event", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: ["nist"] });
    mockCoverage.mockResolvedValue({
      ok: true,
      data: { pack: "nist", controlsWithRule: 1, controlsTotal: 1, controls: [CONTROLS[1]] },
    });
    renderTile();
    await waitFor(() => expect(screen.getByTestId("control-coverage-last")).toBeInTheDocument());
    expect(screen.getByTestId("control-coverage-last").textContent).toBe("No evidence in this period");
  });

  it("renders nothing for a role that may not read the evidence", () => {
    mockAuthorize.mockReturnValue({ allowed: false, loading: false });
    const { container } = renderTile();
    expect(container).toBeEmptyDOMElement();
    expect(mockPacks).not.toHaveBeenCalled();
  });

  it("renders nothing for a tenant with no pack", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: [] });
    const { container } = renderTile();
    await waitFor(() => expect(mockPacks).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockCoverage).not.toHaveBeenCalled();
  });

  it("shows an error text when the read fails", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: ["nist"] });
    mockCoverage.mockResolvedValue({ ok: false, error: "x" });
    renderTile();
    await waitFor(() => expect(screen.getByTestId("control-coverage-error")).toBeInTheDocument());
  });
});
