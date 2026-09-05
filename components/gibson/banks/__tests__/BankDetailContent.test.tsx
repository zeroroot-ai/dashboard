/**
 * BankDetailContent tests (gibson#1706 lane E1): member chips in the docs'
 * words, owner-only edit and delete, and the delete confirmation that counts
 * the open jobs the daemon will abandon.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BankDetailContent } from "../BankDetailContent";
import type { BankView, MemberView } from "@/src/lib/banks/view";

const useBankMock = vi.fn();
const useBankMembersMock = vi.fn();
vi.mock("@/src/hooks/useBanks", () => ({
  useBank: (id: string) => useBankMock(id),
  useBankMembers: (id: string) => useBankMembersMock(id),
  useDeleteBank: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBank: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBank: () => ({ mutate: vi.fn(), isPending: false }),
}));

let sessionUserId = "u1";
vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({ data: { user: { id: sessionUserId, email: "u@x" } }, isPending: false, error: null, refetch: vi.fn() }),
}));

let tenantRole = "member";
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ currentTenant: { id: "t1" }, rolesByTenant: { t1: tenantRole } }),
}));

vi.mock("@/src/hooks/useProviders", () => ({
  useProviders: () => ({ data: { providers: [] } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function bank(over: Partial<BankView> = {}): BankView {
  return {
    id: "bank-1",
    tenantId: "t1",
    owner: { kind: "user", id: "u1" },
    name: "fix-crew",
    desiredCount: 2,
    loginShape: "subscription",
    providerConfigName: "",
    agentName: "claude",
    model: "",
    maxJobsInFlight: 2,
    staleLimitSeconds: 2700,
    spillPolicy: "queue",
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

function member(over: Partial<MemberView> = {}): MemberView {
  return {
    id: "member-1",
    bankId: "bank-1",
    missionId: "m1",
    missionRunId: "r1",
    agentRunId: "run-1",
    sandboxId: "sbx-1",
    state: "idle",
    jobsInFlight: 0,
    cap: 2,
    activeJobIds: [],
    claudeVersion: "2.1.0",
    lastHeartbeat: new Date().toISOString(),
    ...over,
  };
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BankDetailContent bankId="bank-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionUserId = "u1";
  tenantRole = "member";
  useBankMock.mockReset();
  useBankMembersMock.mockReset();
  useBankMock.mockReturnValue({ data: bank(), isLoading: false, error: null });
  useBankMembersMock.mockReturnValue({ data: [], isLoading: false, error: null });
});

describe("BankDetailContent", () => {
  it("shows every member with its state in the docs' words and a console link", () => {
    useBankMembersMock.mockReturnValue({
      data: [
        member({ id: "a", state: "idle" }),
        member({ id: "b", state: "busy", jobsInFlight: 2, cap: 2, activeJobIds: ["j1", "j2"] }),
        member({ id: "c", state: "needs_sign_in", agentRunId: "" }),
        member({ id: "d", state: "draining" }),
        member({ id: "e", state: "dead" }),
      ],
      isLoading: false,
      error: null,
    });
    renderDetail();
    const chips = screen.getAllByTestId("member-state").map((el) => el.textContent);
    expect(chips).toEqual(["idle", "busy 2/2", "needs sign-in", "draining", "dead"]);
    const links = screen.getAllByTestId("member-console-link");
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", "/dashboard/sandboxes?run=run-1");
    expect(screen.getAllByTestId("member-open-jobs").map((el) => el.textContent)).toEqual(["0", "2", "0", "0", "0"]);
    // idle, busy, needs sign-in and draining run; dead does not.
    expect(screen.getByTestId("bank-member-count")).toHaveTextContent("4/2 running");
  });

  it("shows edit and delete to the user owner", () => {
    renderDetail();
    expect(screen.getByTestId("bank-edit")).toBeInTheDocument();
    expect(screen.getByTestId("bank-delete")).toBeInTheDocument();
  });

  it("hides edit and delete from another member, even a tenant admin", () => {
    sessionUserId = "u2";
    tenantRole = "admin";
    renderDetail();
    expect(screen.queryByTestId("bank-manage-actions")).toBeNull();
  });

  it("shows edit and delete to a tenant admin on a tenant-owned bank, not to a member", () => {
    useBankMock.mockReturnValue({ data: bank({ owner: { kind: "tenant", id: "t1" } }), isLoading: false, error: null });
    sessionUserId = "u2";
    tenantRole = "admin";
    const { unmount } = renderDetail();
    expect(screen.getByTestId("bank-manage-actions")).toBeInTheDocument();
    unmount();
    tenantRole = "member";
    renderDetail();
    expect(screen.queryByTestId("bank-manage-actions")).toBeNull();
  });

  it("the delete confirmation counts the open jobs that close as abandoned", () => {
    useBankMembersMock.mockReturnValue({
      data: [member({ id: "a", activeJobIds: ["j1"] }), member({ id: "b", activeJobIds: ["j2", "j3"] })],
      isLoading: false,
      error: null,
    });
    renderDetail();
    fireEvent.click(screen.getByTestId("bank-delete"));
    expect(screen.getByTestId("bank-delete-description")).toHaveTextContent("3 open jobs close with verdict abandoned.");
  });

  it("says when the bank cannot be loaded", () => {
    useBankMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("Bank not found") });
    renderDetail();
    expect(screen.getByText(/Could not load bank/)).toBeInTheDocument();
  });
});
