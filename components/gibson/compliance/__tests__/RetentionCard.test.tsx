// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * RetentionCard (gibson#676, gibson#992): it shows the three periods, sets a
 * longer tenant period, and returns to the period of the installation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@/app/actions/retention", () => ({
  getRetentionAction: mocks.get,
  setRetentionAction: mocks.set,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RetentionCard } from "../RetentionCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RetentionCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ ok: true, data: { tenantMonths: 0, installMonths: 13, effectiveMonths: 13 } });
  mocks.set.mockResolvedValue({ ok: true, data: { tenantMonths: 24, installMonths: 13, effectiveMonths: 24 } });
});

describe("RetentionCard", () => {
  it("shows the period that applies", async () => {
    renderCard();
    expect(await screen.findByTestId("retention-summary")).toHaveTextContent(
      "Postgres keeps them for 13 months. The period of this installation is 13 months. Your organization did not set a period.",
    );
  });

  it("sets a longer period", async () => {
    renderCard();
    await screen.findByTestId("retention-summary");
    await userEvent.type(screen.getByLabelText("Retention period in months"), "24");
    await userEvent.click(screen.getByRole("button", { name: "Set period" }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ months: 24 }));
    expect(await screen.findByText(/Your organization set 24 months/)).toBeInTheDocument();
  });

  it("does not offer a period under the period of the installation", async () => {
    renderCard();
    await screen.findByTestId("retention-summary");
    await userEvent.type(screen.getByLabelText("Retention period in months"), "6");
    expect(screen.getByRole("button", { name: "Set period" })).toBeDisabled();
  });

  it("returns to the period of the installation", async () => {
    mocks.get.mockResolvedValue({ ok: true, data: { tenantMonths: 24, installMonths: 13, effectiveMonths: 24 } });
    mocks.set.mockResolvedValue({ ok: true, data: { tenantMonths: 0, installMonths: 13, effectiveMonths: 13 } });
    renderCard();
    await screen.findByTestId("retention-summary");
    await userEvent.click(screen.getByRole("button", { name: "Use the installation period" }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ months: 0 }));
  });
});
