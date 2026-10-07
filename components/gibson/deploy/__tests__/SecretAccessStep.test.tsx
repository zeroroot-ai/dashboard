// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The secret access step of the deploy wizard (dashboard#174). The list
 * holds only what the tenant-scoped action returns, an empty selection is
 * valid, and a selection is handed to the wizard state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockList = vi.fn();
vi.mock("@/app/actions/read/listSecretNames", () => ({
  listSecretNamesAction: () => mockList(),
}));
vi.mock("@/src/lib/api/fetch", () => ({ apiFetch: vi.fn() }));

import { SecretAccessStep } from "../DeployDispatcher";
import { SECRET_ACCESS_TEXTS } from "../secret-access-texts";

function renderStep(props: Partial<React.ComponentProps<typeof SecretAccessStep>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handlers = {
    selected: [] as string[],
    onSelectedChange: vi.fn(),
    onShowGuide: vi.fn(),
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...props,
  };
  render(
    <QueryClientProvider client={qc}>
      <SecretAccessStep {...handlers} />
    </QueryClientProvider>,
  );
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe("SecretAccessStep", () => {
  it("lists only the secrets that the tenant-scoped action returns", async () => {
    mockList.mockResolvedValue({ ok: true, data: ["cred:db", "cred:github_token"] });
    renderStep();
    const list = await screen.findByTestId("secret-access-list");
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByText("cred:theirs")).not.toBeInTheDocument();
  });

  it("hands a selected secret to the wizard", async () => {
    mockList.mockResolvedValue({ ok: true, data: ["cred:db"] });
    const h = renderStep();
    await userEvent.click(await screen.findByRole("checkbox", { name: "cred:db" }));
    expect(h.onSelectedChange).toHaveBeenCalledWith(["cred:db"]);
  });

  it("goes on with no secret selected", async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    const h = renderStep();
    await waitFor(() => expect(screen.getByText(SECRET_ACCESS_TEXTS.empty)).toBeInTheDocument());
    expect(screen.getByText(SECRET_ACCESS_TEXTS.summary(0))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(h.onNext).toHaveBeenCalledOnce();
  });

  it("shows an error when the secrets cannot be loaded", async () => {
    mockList.mockResolvedValue({ ok: false, error: "denied" });
    renderStep();
    expect(await screen.findByText(SECRET_ACCESS_TEXTS.loadError)).toBeInTheDocument();
  });
});
