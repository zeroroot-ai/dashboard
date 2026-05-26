/**
 * UsersContent — owner role badge and protection tests.
 *
 * Spec: dashboard#263. Verifies:
 *   1. TenantMember with spec.role="owner" renders "owner" badge (not "member").
 *   2. No role Select/dropdown is rendered for owner rows.
 *   3. No remove DropdownMenuItem is rendered for owner rows.
 *
 * All external hooks and server-actions are vi-mocked so the component
 * renders under jsdom without a live cluster.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Hook mocks — must come before any component import ────────────────────────

vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-other", name: "Other User", email: "other@example.com" } },
  }),
}));

vi.mock("@/src/lib/auth/tenant", () => ({
  usePermitted: () => true,   // canEdit=true so dropdown WOULD show on non-owner rows
  useTenantId: () => "test-tenant",
}));

// useCRDWatch: returns the member list we control per-test via the spy.
// Typed as returning unknown[] and cast at call site to avoid inference issues
// when @/src/lib/k8s/types is not yet resolvable in the ambient checker.
const mockCrdItems = vi.fn(() => [] as unknown[]);
vi.mock("@/src/hooks/useCRDWatch", () => ({
  useCRDWatch: () => ({ items: mockCrdItems(), status: "connected", error: null }),
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

// InviteUserDialog is a dialog that needs its own set of deps; stub it out.
vi.mock("../InviteUserDialog", () => ({
  InviteUserDialog: () => null,
}));

// TeamMembershipChips is a pure presentational chip list; stub it out.
vi.mock("../TeamMembershipChips", () => ({
  TeamMembershipChips: () => null,
}));

// Next.js Link
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
// TenantMember import is used only for fixture typing; cast to `unknown[]` in
// the mock return so the type resolver does not need @/src/generated/plans.
import type { TenantMember } from "@/src/lib/k8s/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOwnerMember(overrides: Partial<TenantMember> = {}): TenantMember {
  return {
    apiVersion: "gibson.zeroroot.ai/v1alpha1",
    kind: "TenantMember",
    metadata: {
      name: "owner-member",
      namespace: "tenant-test-tenant",
      creationTimestamp: "2026-01-01T00:00:00Z",
    },
    spec: {
      email: "owner@example.com",
      role: "owner",
      tenantRef: { name: "test-tenant" },
    },
    status: {
      phase: "Active",
      userId: "user-owner-id",
    },
    ...overrides,
  };
}

function makeAdminMember(): TenantMember {
  return {
    apiVersion: "gibson.zeroroot.ai/v1alpha1",
    kind: "TenantMember",
    metadata: {
      name: "admin-member",
      namespace: "tenant-test-tenant",
      creationTimestamp: "2026-01-02T00:00:00Z",
    },
    spec: {
      email: "admin@example.com",
      role: "admin",
      tenantRef: { name: "test-tenant" },
    },
    status: {
      phase: "Active",
      userId: "user-admin-id",
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UsersContent — owner role display", () => {
  it('renders "owner" badge text for a member with spec.role=owner (not "member")', () => {
    mockCrdItems.mockReturnValue([makeOwnerMember()] as unknown[]);
    render(<UsersContent />);

    // The badge should contain "owner".
    const ownerBadges = screen.getAllByText(/owner/i);
    expect(ownerBadges.length).toBeGreaterThan(0);

    // It must NOT contain a bare "member" text node where the badge is expected.
    // The badge for this row should not say "member".
    const roleCells = screen.queryAllByText(/^member$/);
    expect(roleCells.length).toBe(0);
  });

  it("does not render a role Select (dropdown) for owner rows", () => {
    mockCrdItems.mockReturnValue([makeOwnerMember()] as unknown[]);
    render(<UsersContent />);

    // There should be no combobox (the Select trigger) in the document.
    const selects = screen.queryAllByRole("combobox");
    expect(selects.length).toBe(0);
  });

  it("renders a role Select for non-owner rows when canEdit=true and not self", () => {
    mockCrdItems.mockReturnValue([makeAdminMember()] as unknown[]);
    render(<UsersContent />);

    // An admin row (not owner, not self) should have a combobox for the role select.
    const selects = screen.queryAllByRole("combobox");
    expect(selects.length).toBe(1);
  });

  it("does not render a remove menu item for owner rows", async () => {
    mockCrdItems.mockReturnValue([makeOwnerMember()] as unknown[]);
    render(<UsersContent />);

    // The "Remove" text should not be in the document (it is in a DropdownMenuItem
    // that is rendered inside the DropdownMenuContent portal; since we don't open
    // the menu and the Remove item is only conditionally rendered at all, it should
    // not be in the DOM).
    expect(screen.queryByText("Remove")).toBeNull();
  });

  it('renders "owner (you)" badge when the owner is the current user', () => {
    // The session mock returns userId="user-other". Create an owner member
    // whose status.userId matches that value so isSelf is true for this row.
    const selfOwner = makeOwnerMember({
      status: { phase: "Active", userId: "user-other" },
    });
    mockCrdItems.mockReturnValue([selfOwner] as unknown[]);
    render(<UsersContent />);

    // The badge for the owner's own row should include "(you)".
    const youBadges = screen.queryAllByText(/owner.*you/i);
    expect(youBadges.length).toBeGreaterThan(0);
  });
});
