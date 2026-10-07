// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The ontology proposal page (dashboard#191, gibson#618): every proposal
 * field on the row, the Owner's approve and reject on a pending row, the
 * contribution of a promoted row, and no decision for an Admin.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockList, mockApprove, mockReject, mockSubmit, toast, authz } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  mockSubmit: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  authz: { allowed: true, loading: false },
}));
vi.mock("@/app/actions/ontology-proposals", () => ({
  listOntologyProposalsAction: mockList,
  approveOntologyProposalAction: mockApprove,
  rejectOntologyProposalAction: mockReject,
  submitOntologyUpstreamAction: mockSubmit,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/src/lib/auth/use-authorize", () => ({ useAuthorize: () => authz }));

import { OntologyProposalsContent } from "../OntologyProposalsContent";
import {
  ONTOLOGY_TEXT,
  approvedText,
  contributionBody,
  promotedText,
  recurrenceText,
  rejectReasonText,
  rejectedText,
} from "../texts";

const PENDING = {
  kind: "node_label" as const,
  label: "KubernetesOperator",
  recurrence: 3,
  lastProposer: "agent/recon",
  lastClaim: "An operator manages the cluster",
  status: "pending" as const,
  reviewer: "",
  rejectReason: "",
  promoted: false,
  promotedTaxonomyVersion: 0,
};
const PROMOTED = {
  ...PENDING,
  kind: "relationship_type" as const,
  label: "MANAGES",
  recurrence: 5,
  status: "approved" as const,
  reviewer: "owner@example.test",
  promoted: true,
  promotedTaxonomyVersion: 7,
};
const REJECTED = {
  ...PENDING,
  label: "Noise",
  recurrence: 1,
  status: "rejected" as const,
  reviewer: "owner@example.test",
  rejectReason: "Too generic",
};

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OntologyProposalsContent />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue({ ok: true, data: [PENDING, PROMOTED, REJECTED] });
  mockApprove.mockReset();
  mockReject.mockReset();
  mockSubmit.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  authz.allowed = true;
  authz.loading = false;
});

describe("OntologyProposalsContent", () => {
  it("shows each proposal field", async () => {
    wrap();
    const rows = await screen.findAllByTestId("ontology-row");
    expect(rows).toHaveLength(3);
    const pending = within(rows[0]!);
    expect(pending.getByText("Node label")).toBeTruthy();
    expect(pending.getByText("KubernetesOperator")).toBeTruthy();
    expect(pending.getByText(recurrenceText(3))).toBeTruthy();
    expect(pending.getByText("agent/recon")).toBeTruthy();
    expect(pending.getByText("An operator manages the cluster")).toBeTruthy();
    expect(pending.getByText("Pending")).toBeTruthy();
    expect(pending.getByText(ONTOLOGY_TEXT.notInOntology)).toBeTruthy();
    expect(within(rows[1]!).getByText(promotedText(7))).toBeTruthy();
    expect(within(rows[1]!).getByText("owner@example.test")).toBeTruthy();
    expect(within(rows[2]!).getByText(rejectReasonText("Too generic"))).toBeTruthy();
  });

  it("states that no agent proposed an extension", async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    wrap();
    expect(await screen.findByTestId("ontology-empty")).toHaveTextContent(ONTOLOGY_TEXT.empty);
  });

  it("lets the Owner approve a pending proposal", async () => {
    mockApprove.mockResolvedValue({ ok: true, data: null });
    wrap();
    const rows = await screen.findAllByTestId("ontology-row");
    await userEvent.click(within(rows[0]!).getByRole("button", { name: ONTOLOGY_TEXT.approve }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith({ kind: "node_label", label: "KubernetesOperator" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(approvedText("KubernetesOperator")));
  });

  it("lets the Owner reject a pending proposal with a reason", async () => {
    mockReject.mockResolvedValue({ ok: true, data: null });
    wrap();
    const rows = await screen.findAllByTestId("ontology-row");
    await userEvent.click(within(rows[0]!).getByRole("button", { name: ONTOLOGY_TEXT.reject }));
    await userEvent.type(await screen.findByLabelText(ONTOLOGY_TEXT.reasonLabel), "Duplicate");
    await userEvent.click(screen.getByRole("button", { name: ONTOLOGY_TEXT.rejectConfirm }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith({
        kind: "node_label",
        label: "KubernetesOperator",
        reason: "Duplicate",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(rejectedText("KubernetesOperator")));
  });

  it("shows the contribution of a promoted proposal", async () => {
    mockSubmit.mockResolvedValue({
      ok: true,
      data: {
        auditRecordId: "42",
        packJson: '{"name":"MANAGES"}',
        suggestedFilePath: "packs/manages.json",
        suggestedPrTitle: "feat(packs): MANAGES",
        suggestedPrBody: "Adds MANAGES.",
      },
    });
    wrap();
    const rows = await screen.findAllByTestId("ontology-row");
    expect(within(rows[0]!).queryByRole("button", { name: ONTOLOGY_TEXT.submit })).toBeNull();
    await userEvent.click(within(rows[1]!).getByRole("button", { name: ONTOLOGY_TEXT.submit }));
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith({ kind: "relationship_type", label: "MANAGES" }),
    );
    expect(await screen.findByText(contributionBody("42"))).toBeTruthy();
    expect(screen.getByText("packs/manages.json")).toBeTruthy();
    expect(screen.getByText("feat(packs): MANAGES")).toBeTruthy();
    expect(screen.getByText('{"name":"MANAGES"}')).toBeTruthy();
  });

  it("shows no decision to a role that may not decide", async () => {
    authz.allowed = false;
    wrap();
    const rows = await screen.findAllByTestId("ontology-row");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
  });
});
