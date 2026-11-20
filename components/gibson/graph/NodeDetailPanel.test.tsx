// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { NodeDetailPanel } from "./NodeDetailPanel";

function renderPanel(labels: string[]) {
  const node = { id: "inc/1", labels, properties: { name: "Odd login" } };
  return render(<NodeDetailPanel node={node} onClose={vi.fn()} onFindPaths={vi.fn()} />);
}

describe("NodeDetailPanel, the incident report link", () => {
  it("links an Incident node to its report", () => {
    renderPanel(["Incident"]);
    expect(screen.getByTestId("incident-report-link").getAttribute("href")).toBe("/dashboard/incidents/inc%2F1");
  });

  it("shows no link for another node", () => {
    renderPanel(["Finding"]);
    expect(screen.queryByTestId("incident-report-link")).toBeNull();
  });
});
