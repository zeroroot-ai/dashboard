// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * UserDetailPage, Owner-rule tests (hosted#190 / ADR-0093 rule 5).
 *
 * The page is the only place "Transfer ownership" appears. Verifies:
 *   1. An Admin viewer never sees "Transfer ownership", even for a target
 *      that is an active Admin (the only kind of target the button ever
 *      targets).
 *   2. The current Owner sees "Transfer ownership" for an active-admin
 *      target, and confirming it calls transferOwnershipAction with the
 *      target's userId.
 *   3. The Owner row never gets a role dropdown or a "Revoke access" button,
 *      whoever is viewing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemberRow } from "@/app/actions/read/listMembers";

// ── Hook + navigation mocks, must come before the page import ────────────────

vi.mock("next/navigation", () => ({
  useParams: () => ({ userId: "user-target" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let sessionUserId = "user-viewer";
vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({ data: { user: { id: sessionUserId, email: "viewer@example.com" } } }),
}));

vi.mock("@/src/lib/auth/tenant", () => ({
  useTenantId: () => "test-tenant",
}));

let canManageMembers = true;
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: () => ({ allowed: canManageMembers, loading: false }),
}));

let viewerRole = "admin";
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ rolesByTenant: { "test-tenant": viewerRole } }),
}));

const mockMembers = vi.fn(async () => ({ ok: true, data: [] as MemberRow[] }));
vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: () => mockMembers(),
}));

const transferOwnershipActionMock = vi.fn(async (_userId: string) => ({ ok: true, data: { applied: true } }));
vi.mock("@/app/actions/crd/transfer-ownership", () => ({
  transferOwnershipAction: (userId: string) => transferOwnershipActionMock(userId),
}));

vi.mock("@/app/actions/crd/member", () => ({
  revokeMemberAction: vi.fn(async () => ({ ok: true, data: undefined })),
  resendInvitationAction: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/app/actions/crd/role", () => ({
  setTenantRoleAction: vi.fn(async () => ({ ok: true, data: { applied: true } })),
}));

vi.mock("@/app/actions/crd/sessions", () => ({
  revokeUserSessionsAction: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/components/gibson/users/UserTeamMembershipsEditor", () => ({
  UserTeamMembershipsEditor: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserId = "user-viewer";
  canManageMembers = true;
  viewerRole = "admin";
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class FakeResizeObserver {
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

// ── Import the page after mocks ───────────────────────────────────────────────

import UserDetailPage from "../page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UserDetailPage />
    </QueryClientProvider>,
  );
}

function member(over: Partial<MemberRow>): MemberRow {
  return {
    userId: "user-target",
    displayName: "",
    email: "target@example.com",
    role: "admin",
    joinedAt: "2026-01-01T00:00:00Z",
    status: "active",
    ...over,
  };
}

describe("UserDetailPage, transfer ownership visibility", () => {
  it("an Admin viewer never sees Transfer ownership for an active-admin target", async () => {
    viewerRole = "admin";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "admin" })] });
    renderPage();
    await screen.findByText("target@example.com");
    expect(screen.queryByText("Transfer ownership")).toBeNull();
  });

  it("the current Owner sees Transfer ownership for an active-admin target", async () => {
    viewerRole = "owner";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "admin" })] });
    renderPage();
    await screen.findByText("target@example.com");
    expect(screen.getByText("Transfer ownership")).toBeInTheDocument();
  });

  it("confirming the transfer calls transferOwnershipAction with the target's userId", async () => {
    viewerRole = "owner";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "admin" })] });
    renderPage();
    await screen.findByText("target@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    const confirmButton = await screen.findByRole("button", { name: "Transfer Ownership" });
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(transferOwnershipActionMock).toHaveBeenCalledWith("user-target");
    });
  });

  it("the current Owner does not see Transfer ownership for a non-admin target", async () => {
    viewerRole = "owner";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "member" })] });
    renderPage();
    await screen.findByText("target@example.com");
    expect(screen.queryByText("Transfer ownership")).toBeNull();
  });
});

describe("UserDetailPage, the owner row cannot be demoted or removed", () => {
  it("renders no role dropdown and no Revoke access button for an owner target, viewed by an admin", async () => {
    viewerRole = "admin";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "owner" })] });
    renderPage();
    await screen.findByText("target@example.com");
    expect(screen.queryByText("Change role")).toBeNull();
    expect(screen.queryByText("Revoke access")).toBeNull();
    expect(screen.queryByText("Transfer ownership")).toBeNull();
  });

  it("renders no role dropdown and no Revoke access button for an owner target, viewed by the owner themselves", async () => {
    viewerRole = "owner";
    sessionUserId = "user-target";
    mockMembers.mockResolvedValue({ ok: true, data: [member({ role: "owner" })] });
    renderPage();
    await screen.findByText("target@example.com");
    expect(screen.queryByText("Change role")).toBeNull();
    expect(screen.queryByText("Revoke access")).toBeNull();
  });
});
