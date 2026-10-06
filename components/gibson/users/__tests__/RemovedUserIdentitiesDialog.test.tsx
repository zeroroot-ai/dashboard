// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * RemovedUserIdentitiesDialog (gibson#568, dashboard#178): after a removal
 * the users page lists the identities that the removed user enrolled, with a
 * way to hand each one over or revoke it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemberRow } from "@/app/actions/read/listMembers";

const mocks = vi.hoisted(() => ({
  describe: vi.fn(),
  reassign: vi.fn(async () => ({ ok: true, data: undefined })),
  retire: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/app/actions/read/listAgentIdentities", () => ({
  describeIdentitiesAction: mocks.describe,
}));

vi.mock("@/app/actions/crd/member", () => ({
  reassignAgentIdentityAction: mocks.reassign,
  retireAgentIdentityAction: mocks.retire,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RemovedUserIdentitiesDialog } from "../RemovedUserIdentitiesDialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.describe.mockResolvedValue({
    ok: true,
    data: [{ id: "agent_principal:sa-1", name: "nightly-scanner", kind: "agent" }],
  });
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
});

const members: MemberRow[] = [
  { userId: "caller", displayName: "", email: "caller@example.com", role: "admin", joinedAt: "", status: "active" },
  { userId: "dave", displayName: "", email: "dave@example.com", role: "writer", joinedAt: "", status: "active" },
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RemovedUserIdentitiesDialog
        removedEmail="carol@example.com"
        principalIds={["agent_principal:sa-1"]}
        currentOwnerUserId="caller"
        members={members}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("RemovedUserIdentitiesDialog", () => {
  it("lists the agent that the removed user enrolled", async () => {
    renderDialog();
    expect(await screen.findByText("nightly-scanner")).toBeInTheDocument();
    expect(screen.getByText(/Identities of carol@example.com/)).toBeInTheDocument();
    expect(mocks.describe).toHaveBeenCalledWith(["agent_principal:sa-1"]);
  });

  it("revokes an identity", async () => {
    renderDialog();
    await screen.findByText("nightly-scanner");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mocks.retire).toHaveBeenCalledWith({ principalId: "agent_principal:sa-1" }));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });

  it("does not hand over before a new owner is chosen", async () => {
    renderDialog();
    await screen.findByText("nightly-scanner");
    expect(screen.getByRole("button", { name: "Hand over" })).toBeDisabled();
  });

  it("renders nothing when no identity moved", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <RemovedUserIdentitiesDialog
          removedEmail="carol@example.com"
          principalIds={[]}
          currentOwnerUserId="caller"
          members={members}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Identities of/)).not.toBeInTheDocument();
    expect(mocks.describe).not.toHaveBeenCalled();
  });
});
