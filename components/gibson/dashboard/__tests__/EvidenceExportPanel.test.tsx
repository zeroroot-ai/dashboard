// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockPacks, mockEvidence, mockAuthorize, mockDownload } = vi.hoisted(() => ({
  mockPacks: vi.fn(),
  mockEvidence: vi.fn(),
  mockAuthorize: vi.fn(),
  mockDownload: vi.fn(),
}));
vi.mock("@/app/actions/compliance", () => ({
  listCompliancePacksAction: mockPacks,
  getComplianceEvidenceAction: mockEvidence,
}));
vi.mock("@/src/lib/auth/use-authorize", () => ({ useAuthorize: mockAuthorize }));
vi.mock("@/components/gibson/compliance/export", async (orig) => ({
  ...(await orig<typeof import("@/components/gibson/compliance/export")>()),
  download: mockDownload,
}));

import { EvidenceExportPanel } from "../EvidenceExportPanel";

const REPORT = {
  pack: "nist-800-53-r5",
  packVersion: 1,
  controlsWithRule: 1,
  controlsTotal: 1,
  controls: [
    {
      controlId: "AC-2",
      title: "Account Management",
      family: "AC",
      familyTitle: "Access Control",
      state: "has_evidence",
      eventCount: 1,
      lastEventTime: "2026-10-01T12:00:00.000Z",
    },
  ],
  events: [
    {
      auditRecordId: "r1",
      time: "2026-10-01T12:00:00.000Z",
      action: "member.add",
      actorId: "u1",
      resourceType: "member",
      resourceId: "m1",
      controlIds: ["AC-2"],
    },
  ],
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EvidenceExportPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPacks.mockReset();
  mockEvidence.mockReset();
  mockAuthorize.mockReset();
  mockDownload.mockReset();
  mockAuthorize.mockReturnValue({ allowed: true, loading: false });
  mockPacks.mockResolvedValue({ ok: true, data: ["nist-800-53-r5"] });
});

describe("EvidenceExportPanel", () => {
  it("exports the CSV of the range with the compliance reader", async () => {
    mockEvidence.mockResolvedValue({ ok: true, data: REPORT });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockEvidence.mock.calls[0][0]).toMatchObject({ pack: "nist-800-53-r5" });
    const [name, mime, body] = mockDownload.mock.calls[0];
    expect(name).toBe("nist-800-53-r5-evidence.csv");
    expect(mime).toBe("text/csv");
    expect(body).toContain("AC-2");
    expect(body).toContain("r1");
  });

  it("exports the JSON of the range", async () => {
    mockEvidence.mockResolvedValue({ ok: true, data: REPORT });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /Export JSON/ }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    const [name, , body] = mockDownload.mock.calls[0];
    expect(name).toBe("nist-800-53-r5-evidence.json");
    expect(JSON.parse(body).controls[0].events[0].auditRecordId).toBe("r1");
  });

  it("shows the error and downloads nothing when the read fails", async () => {
    mockEvidence.mockResolvedValue({ ok: false, error: "Permission denied" });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(screen.getByTestId("evidence-export-error")).toBeInTheDocument());
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("says what the file does not hold yet", async () => {
    renderPanel();
    expect(screen.getByTestId("evidence-not-yet").textContent).toContain("D3FEND");
  });

  it("tells a role that may not read evidence that only an Owner or an Admin can export", () => {
    mockAuthorize.mockReturnValue({ allowed: false, loading: false });
    renderPanel();
    expect(screen.getByTestId("evidence-not-allowed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
    expect(mockPacks).not.toHaveBeenCalled();
  });

  it("shows the approved no-pack text for a tenant with no pack", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("evidence-no-pack")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
  });
});
