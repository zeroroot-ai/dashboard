/**
 * UsersContent, owner role badge and protection tests.
 *
 * Post dashboard#715 the roster comes from the daemon via listMembersAction
 * (React Query), not the TenantMember CR. Verifies:
 *   1. role="owner" renders an "owner" badge (not "member").
 *   2. No role Select/dropdown is rendered for owner rows.
 *   3. A role Select IS rendered for non-owner, non-self rows.
 *   4. No Remove menu item for owner rows.
 *   5. "owner (you)" badge when the owner is the current user.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemberRow } from "@/app/actions/read/listMembers";

// ── Hook mocks, must come before any component import ────────────────────────

vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-other", name: "Other User", email: "other@example.com" } },
  }),
}));

vi.mock("@/src/lib/auth/tenant", () => ({
  useTenantId: () => "test-tenant",
}));

vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: () => ({ allowed: true, loading: false }),
}));

// Roster source: listMembersAction, controlled per-test via the spy.
const mockMembers = vi.fn(async () => ({ ok: true, data: [] as MemberRow[] }));
vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: () => mockMembers(),
}));

vi.mock("@/src/hooks/use-org-graph", () => ({
  useOrgGraph: () => ({ data: { byUser: {} }, loading: false }),
}));

vi.mock("@/app/actions/crd/member", () => ({
  revokeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
}));

vi.mock("@/app/actions/crd/role", () => ({
  setTenantRoleAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../InviteUserDialog", () => ({
  InviteUserDialog: () => null,
}));

vi.mock("../TeamMembershipChips", () => ({
  TeamMembershipChips: () => null,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── ResizeObserver shim (Radix Select/DropdownMenu polyfill) ──────────────────

beforeEach(() => {
  vi.clearAllMocks();
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

// ── Import component after mocks ──────────────────────────────────────────────

import { UsersContent } from "../UsersContent";

function renderWithQuery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersContent />
    </QueryClientProvider>,
  );
}

function member(over: Partial<MemberRow>): MemberRow {
  return {
    userId: "u",
    displayName: "",
    email: "u@example.com",
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
    status: "active",
    ...over,
  };
}

const owner = () => member({ userId: "user-owner-id", email: "owner@example.com", role: "owner" });
const admin = () => member({ userId: "user-admin-id", email: "admin@example.com", role: "admin" });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UsersContent, owner role display", () => {
  it('renders "owner" badge text (not "member") for an owner', async () => {
    mockMembers.mockResolvedValue({ ok: true, data: [owner()] });
    renderWithQuery();
    expect((await screen.findAllByText(/owner/i)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^member$/).length).toBe(0);
  });

  it("does not render a role Select for owner rows", async () => {
    mockMembers.mockResolvedValue({ ok: true, data: [owner()] });
    renderWithQuery();
    await screen.findByText("owner@example.com");
    expect(screen.queryAllByRole("combobox").length).toBe(0);
  });

  it("renders a role Select for non-owner rows when canEdit=true and not self", async () => {
    mockMembers.mockResolvedValue({ ok: true, data: [admin()] });
    renderWithQuery();
    await screen.findByText("admin@example.com");
    expect(screen.queryAllByRole("combobox").length).toBe(1);
  });

  it("does not render a remove menu item for owner rows", async () => {
    mockMembers.mockResolvedValue({ ok: true, data: [owner()] });
    renderWithQuery();
    await screen.findByText("owner@example.com");
    expect(screen.queryByText("Remove")).toBeNull();
  });

  it('renders "owner (you)" badge when the owner is the current user', async () => {
    mockMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "user-other", email: "owner@example.com", role: "owner" })],
    });
    renderWithQuery();
    expect((await screen.findAllByText(/owner.*you/i)).length).toBeGreaterThan(0);
  });
});
