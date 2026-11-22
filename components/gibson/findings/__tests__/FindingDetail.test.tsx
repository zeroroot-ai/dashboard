// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getFinding, exportFindings } = vi.hoisted(() => ({ getFinding: vi.fn(), exportFindings: vi.fn() }));
vi.mock("@/app/actions/findings", () => ({
  getFindingAction: getFinding,
  exportFindingsAction: exportFindings,
}));

vi.mock("../ActivityStrip", () => ({ ActivityStrip: ({ findingId }: { findingId: string }) => <div data-testid="activity-strip" data-finding={findingId} /> }));

import { FindingDetail } from "../FindingDetail";
import { FindingsExportDialog } from "../FindingsExportDialog";
import type { Finding } from "@/src/types";

const finding = {
  id: "f1",
  title: "SQL injection <b>x</b>",
  description: "A **plain** description",
  category: "injection",
  severity: "high",
  confidence: 0.85,
  missionId: "m1",
  agentName: "scout",
  submittedBy: "agent:1",
  createdAt: "2026-11-18T10:00:00.000Z",
  evidence: [
    { title: "req", kind: "request", tier: "recorded", toolCallId: "call-1", content: "GET /", metadata: {} },
    { title: "note", kind: "other", tier: "typed", toolCallId: "", content: "typed text", metadata: {} },
  ],
};

beforeEach(() => {
  getFinding.mockReset();
  exportFindings.mockReset();
});

describe("FindingDetail", () => {
  it("loads the finding by id with GetFinding and shows its fields and all evidence", async () => {
    getFinding.mockResolvedValue({ ok: true, data: finding });
    render(<FindingDetail id="f1" />);
    expect(await screen.findByTestId("finding-title")).toHaveTextContent("SQL injection <b>x</b>");
    expect(getFinding).toHaveBeenCalledWith("f1");
    expect(screen.getAllByTestId("evidence-item")).toHaveLength(2);
    expect(screen.getByText("Recorded by Gibson")).toBeInTheDocument();
    expect(screen.getByText("Typed by the agent")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "m1" })).toHaveAttribute("href", "/dashboard/results/m1");
  });

  it("shows the description as plain text", async () => {
    getFinding.mockResolvedValue({ ok: true, data: finding });
    const { container } = render(<FindingDetail id="f1" />);
    expect(await screen.findByTestId("finding-description")).toHaveTextContent("A **plain** description");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows an error when the finding cannot load", async () => {
    getFinding.mockResolvedValue({ ok: false, error: "The finding was not found.", code: "not_found" });
    render(<FindingDetail id="f1" />);
    expect(await screen.findByText("The finding was not found.")).toBeInTheDocument();
  });
});

describe("FindingsExportDialog, include evidence", () => {
  const findings = [{ id: "id-1" }, { id: "id-2" }] as unknown as Finding[];

  it("passes include_evidence through the export action and offers the file", async () => {
    exportFindings.mockResolvedValue({
      ok: true,
      data: { filename: "f.json", format: "json", count: 2, text: "{}" },
    });
    const create = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { ...URL, createObjectURL: create, revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    render(<FindingsExportDialog open onOpenChange={vi.fn()} findings={findings} />);
    await user.click(screen.getByLabelText(/JSON/));
    await user.click(screen.getByLabelText("Include evidence"));
    await user.click(screen.getByRole("button", { name: /download json/i }));
    expect(exportFindings).toHaveBeenCalledWith({
      format: "json",
      findingIds: ["id-1", "id-2"],
      includeEvidence: true,
    });
    expect(create).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not call the daemon when evidence is not asked for", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    render(<FindingsExportDialog open onOpenChange={vi.fn()} findings={findings} />);
    await user.click(screen.getByLabelText(/JSON/));
    await user.click(screen.getByRole("button", { name: /download json/i }));
    expect(exportFindings).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows the error of a refused export as text", async () => {
    exportFindings.mockResolvedValue({ ok: false, error: "Choose at least one finding.", code: "bad_input" });
    const user = userEvent.setup();
    render(<FindingsExportDialog open onOpenChange={vi.fn()} findings={findings} />);
    await user.click(screen.getByLabelText(/JSON/));
    await user.click(screen.getByLabelText("Include evidence"));
    await user.click(screen.getByRole("button", { name: /download json/i }));
    expect(await screen.findByTestId("export-error")).toHaveTextContent("Choose at least one finding.");
  });
});
