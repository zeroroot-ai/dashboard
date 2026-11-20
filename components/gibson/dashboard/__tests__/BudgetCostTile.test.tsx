// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listStatus } = vi.hoisted(() => ({ listStatus: vi.fn() }));
vi.mock("@/app/actions/crud/budgets", () => ({ listBudgetStatusAction: listStatus }));

import { BudgetCostTile } from "../BudgetCostTile";
import type { FixCost } from "@/src/lib/cost/budget-burn";

function renderTile(fixCosts?: readonly FixCost[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BudgetCostTile fixCosts={fixCosts} />
    </QueryClientProvider>,
  );
}

function status(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: [
      {
        scope: "tenant",
        subjectId: "t",
        currentTokens: 1,
        currentSpendUsdCents: 2500,
        tokenLimit: 0,
        spendLimitUsdCents: 10000,
        periodResetAtUnix: 1_800_000_000,
        warningCrossed: false,
        ...over,
      },
    ],
  };
}

beforeEach(() => listStatus.mockReset());

describe("BudgetCostTile", () => {
  it("shows the budget spend and the reset date", async () => {
    listStatus.mockResolvedValue(status());
    renderTile();
    await waitFor(() => expect(screen.getByTestId("budget-spent")).toBeInTheDocument());
    expect(screen.getByTestId("budget-spent").textContent).toBe("$25.00 of $100.00 spent");
    expect(screen.getByTestId("budget-reset")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-warning")).toBeNull();
    expect(listStatus).toHaveBeenCalledWith("tenant");
  });

  it("shows a warning when the warning threshold is crossed", async () => {
    listStatus.mockResolvedValue(status({ warningCrossed: true }));
    renderTile();
    await waitFor(() => expect(screen.getByTestId("budget-warning")).toBeInTheDocument());
    expect(screen.getByTestId("budget-warning").textContent).toContain("warning threshold");
  });

  it("shows a stronger warning when the spend reaches the limit", async () => {
    listStatus.mockResolvedValue(status({ currentSpendUsdCents: 10000, warningCrossed: true }));
    renderTile();
    await waitFor(() => expect(screen.getByTestId("budget-warning")).toBeInTheDocument());
    expect(screen.getByTestId("budget-warning").textContent).toContain("reached the limit");
  });

  it("says no budget is set when the daemon returns no row", async () => {
    listStatus.mockResolvedValue({ ok: true, data: [] });
    renderTile();
    await waitFor(() => expect(screen.getByTestId("budget-none")).toBeInTheDocument());
  });

  it("shows the cost for each verified fix as unknown, with a note, when no source exists", async () => {
    listStatus.mockResolvedValue(status());
    renderTile();
    expect(screen.getByTestId("fix-cost-value").textContent).toBe("unknown");
    expect(screen.getByTestId("fix-cost-note").textContent).toContain("not available yet");
  });

  it("shows the median cost for each verified fix when a source gives costs", async () => {
    listStatus.mockResolvedValue(status());
    renderTile([
      { findingId: "a", costUsdCents: 100 },
      { findingId: "b", costUsdCents: 300 },
      { findingId: "c", costUsdCents: null },
    ]);
    expect(screen.getByTestId("fix-cost-value").textContent).toBe("$2.00");
    expect(screen.queryByTestId("fix-cost-note")).toBeNull();
    expect(screen.getByText("1 verified fix has an unknown cost.")).toBeInTheDocument();
  });

  it("shows unknown, not zero, when no verified fix has a known cost", () => {
    listStatus.mockResolvedValue(status());
    renderTile([{ findingId: "a", costUsdCents: null }]);
    expect(screen.getByTestId("fix-cost-value").textContent).toBe("unknown");
  });
});
