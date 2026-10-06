// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The "Compliance" menu entry shows only for the Owner and the Admin, and
 * only when the tenant enabled a compliance pack (D56).
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockPacks, auth } = vi.hoisted(() => ({
  mockPacks: vi.fn(),
  auth: { allowed: true, loading: false },
}));
vi.mock("@/app/actions/compliance", () => ({ listCompliancePacksAction: mockPacks }));
vi.mock("@/src/lib/auth/use-authorize", () => ({ useAuthorize: () => auth }));

import { ComplianceNavGate } from "../ComplianceNavGate";

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComplianceNavGate>
        <span>entry</span>
      </ComplianceNavGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPacks.mockReset().mockResolvedValue({ ok: true, data: ["nist-800-53-r5"] });
  auth.allowed = true;
  auth.loading = false;
});

describe("ComplianceNavGate", () => {
  it("shows the entry to an Owner or Admin of a tenant with a pack", async () => {
    renderGate();
    expect(await screen.findByText("entry")).toBeInTheDocument();
  });

  it("hides the entry from a role without the admin relation, and asks nothing", () => {
    auth.allowed = false;
    renderGate();
    expect(screen.queryByText("entry")).toBeNull();
    expect(mockPacks).not.toHaveBeenCalled();
  });

  it("hides the entry when the tenant enabled no compliance pack", async () => {
    mockPacks.mockResolvedValue({ ok: true, data: [] });
    renderGate();
    await vi.waitFor(() => expect(mockPacks).toHaveBeenCalled());
    expect(screen.queryByText("entry")).toBeNull();
  });
});
