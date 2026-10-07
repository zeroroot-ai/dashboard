// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The registration queue (dashboard#193, gibson#620): the rows, the empty
 * queue, an approval, a rejection with a
 * reason, a decision that another administrator already made, and the menu
 * gate.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockList, mockApprove, mockReject, toast } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/app/actions/registrations", () => ({
  listPendingRegistrationsAction: mockList,
  approveRegistrationAction: mockApprove,
  rejectRegistrationAction: mockReject,
}));
vi.mock("sonner", () => ({ toast }));

import { RegistrationsContent } from "../RegistrationsContent";
import { RegistrationsNavGate } from "../RegistrationsNavGate";
import { REGISTRATIONS_TEXT, approvedText, rejectFailedText, rejectTitle } from "../texts";

const ROWS = [
  {
    registrationId: "reg-1",
    ownerEmail: "ada@example.test",
    workspaceName: "Analytical",
    tier: "team",
    ownerFirstName: "Ada",
    ownerLastName: "Lovelace",
    receivedAt: "2026-10-07T09:30:00.000Z",
  },
  {
    registrationId: "reg-2",
    ownerEmail: "alan@example.test",
    workspaceName: "Bombe",
    tier: "org",
    ownerFirstName: "",
    ownerLastName: "",
    receivedAt: null,
  },
];

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue({ ok: true, data: ROWS });
  mockApprove.mockReset();
  mockReject.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("RegistrationsContent", () => {
  it("shows one row for each registration", async () => {
    wrap(<RegistrationsContent />);
    const rows = await screen.findAllByTestId("registration-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("ada@example.test")).toBeTruthy();
    expect(within(rows[0]!).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(rows[0]!).getByText("Analytical")).toBeTruthy();
    expect(screen.getByText(REGISTRATIONS_TEXT.title)).toBeTruthy();
    expect(screen.getByText(REGISTRATIONS_TEXT.intro)).toBeTruthy();
  });

  it("states when each registration arrived", async () => {
    wrap(<RegistrationsContent />);
    const rows = await screen.findAllByTestId("registration-row");
    expect(screen.getByText(REGISTRATIONS_TEXT.columnReceived)).toBeTruthy();
    const time = rows[0]!.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-10-07T09:30:00.000Z");
    expect(time?.textContent).toBe(new Date("2026-10-07T09:30:00.000Z").toLocaleString());
    expect(rows[1]!.querySelector("time")).toBeNull();
  });

  it("states that no registration waits", async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    wrap(<RegistrationsContent />);
    expect(await screen.findByTestId("registrations-empty")).toHaveTextContent(
      REGISTRATIONS_TEXT.empty,
    );
  });

  it("approves a registration by its id and reads the queue again", async () => {
    mockApprove.mockResolvedValue({
      ok: true,
      data: { tenantId: "analytical", ownerUserId: "u1", planId: "team" },
    });
    wrap(<RegistrationsContent />);
    const rows = await screen.findAllByTestId("registration-row");
    await userEvent.click(within(rows[0]!).getByRole("button", { name: REGISTRATIONS_TEXT.approve }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("reg-1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(approvedText("analytical")));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it("rejects a registration with the reason the administrator wrote", async () => {
    mockReject.mockResolvedValue({ ok: true, data: null });
    wrap(<RegistrationsContent />);
    const rows = await screen.findAllByTestId("registration-row");
    await userEvent.click(within(rows[1]!).getByRole("button", { name: REGISTRATIONS_TEXT.reject }));
    expect(await screen.findByText(rejectTitle("alan@example.test"))).toBeTruthy();
    expect(screen.getByText(REGISTRATIONS_TEXT.rejectBody)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(REGISTRATIONS_TEXT.reasonLabel), "Unknown company");
    await userEvent.click(screen.getByRole("button", { name: REGISTRATIONS_TEXT.rejectConfirm }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith({ registrationId: "reg-2", reason: "Unknown company" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REGISTRATIONS_TEXT.rejected));
  });

  it("states that another administrator already decided", async () => {
    mockReject.mockResolvedValue({
      ok: false,
      error: REGISTRATIONS_TEXT.alreadyDecided,
      code: "already_decided",
    });
    wrap(<RegistrationsContent />);
    const rows = await screen.findAllByTestId("registration-row");
    await userEvent.click(within(rows[0]!).getByRole("button", { name: REGISTRATIONS_TEXT.reject }));
    await userEvent.click(await screen.findByRole("button", { name: REGISTRATIONS_TEXT.rejectConfirm }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(rejectFailedText(REGISTRATIONS_TEXT.alreadyDecided)),
    );
  });
});

describe("RegistrationsNavGate", () => {
  it("shows the entry when the queue read succeeds", async () => {
    wrap(
      <RegistrationsNavGate>
        <span>entry</span>
      </RegistrationsNavGate>,
    );
    expect(await screen.findByText("entry")).toBeTruthy();
  });

  it("hides the entry when the read is denied", async () => {
    mockList.mockResolvedValue({ ok: false, error: "Permission denied", code: "permission_denied" });
    wrap(
      <RegistrationsNavGate>
        <span>entry</span>
      </RegistrationsNavGate>,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText("entry")).toBeNull();
  });
});
