// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Each panel has its own test. Here the panel stands in for itself, so this
// test checks the order and the content of the screen.
vi.mock("../FindingsPanel", () => ({ FindingsPanel: () => <section data-testid="panel-findings" /> }));
vi.mock("../ExposurePanel", () => ({ ExposurePanel: () => <section data-testid="panel-exposure" /> }));
vi.mock("../WaitsPanel", () => ({ WaitsPanel: () => <section data-testid="panel-waits" /> }));
vi.mock("../EvidenceExportPanel", () => ({
  EvidenceExportPanel: () => <section data-testid="panel-evidence" />,
}));
vi.mock("../ControlCoverageTile", () => ({ ControlCoverageTile: () => <div data-testid="tile-coverage" /> }));
vi.mock("../BudgetCostTile", () => ({ BudgetCostTile: () => <div data-testid="tile-cost" /> }));

import { DashboardContent } from "../DashboardContent";

describe("DashboardContent", () => {
  it("shows the five panels in the order of the five questions", () => {
    const { container } = render(<DashboardContent />);
    const order = [...container.querySelectorAll("[data-testid^='panel-']")]
      .map((el) => el.getAttribute("data-testid"))
      .filter((id) => !id?.endsWith("-unavailable"));
    expect(order).toEqual([
      "panel-findings",
      "panel-exposure",
      "panel-actions",
      "panel-waits",
      "panel-evidence",
    ]);
  });

  it("says that the data of panel 3 is not available yet and shows no number", () => {
    render(<DashboardContent />);
    const text = screen.getByTestId("panel-actions-unavailable").textContent ?? "";
    expect(text).toContain("not available yet");
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s*%/);
  });

  it("holds none of the old count cards", () => {
    render(<DashboardContent />);
    for (const label of ["Graph Nodes", "Active Missions", "Total Findings", "Agents Online"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});
