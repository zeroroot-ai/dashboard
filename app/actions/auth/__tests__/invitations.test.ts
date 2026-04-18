/**
 * Unit tests for listPendingInvitationsAction.
 *
 * Verifies:
 * 1. Unauthenticated call → UNAUTHENTICATED result.
 * 2. Only the signed-in user's email is used for filtering (never leaks).
 * 3. Expired invitations are excluded.
 * 4. Non-pending invitations (accepted, rejected, canceled) are excluded.
 * 5. Valid pending, non-expired invitations are returned.
 * 6. Adapter failure → graceful empty response (invitations optional affordance).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — installed BEFORE any SUT import.
// ---------------------------------------------------------------------------

// Mock getServerSession so we can inject arbitrary sessions.
vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock auth-server to provide a dummy auth.$context.
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({}),
  },
}));

// The org adapter mock is installed per-test via mockGetOrgAdapter.
const mockListUserInvitations = vi.fn();

vi.mock("better-auth/plugins/organization", () => ({
  getOrgAdapter: vi.fn(() => ({
    listUserInvitations: mockListUserInvitations,
  })),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------

import { listPendingInvitationsAction } from "../invitations";
import { getServerSession } from "@/src/lib/auth";

const getSessionMock = getServerSession as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(email: string) {
  return {
    user: {
      id: "user-abc",
      name: "Test User",
      email,
      image: null,
      groups: [],
      roles: ["member"],
      tenantId: null,
      tenants: [],
      rolesByTenant: {},
      permissions: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function futureDate(offsetMs = 86_400_000) {
  return new Date(Date.now() + offsetMs);
}

function pastDate(offsetMs = 86_400_000) {
  return new Date(Date.now() - offsetMs);
}

function makeInvitation(overrides: Partial<{
  id: string;
  organizationId: string;
  organizationName: string | null;
  role: string;
  status: string;
  expiresAt: Date | string | null;
  inviterId: string;
  inviter: { email: string; name: string | null } | null;
}> = {}) {
  return {
    id: "inv-1",
    organizationId: "org-1",
    organizationName: "Acme Corp",
    role: "member",
    status: "pending",
    expiresAt: futureDate(),
    inviterId: "inviter-user-1",
    inviter: { email: "boss@acme.io", name: "Boss" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPendingInvitationsAction", () => {
  describe("unauthenticated", () => {
    it("returns UNAUTHENTICATED when there is no session", async () => {
      getSessionMock.mockResolvedValueOnce(null);

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNAUTHENTICATED");
        expect(result.message).toBeTruthy();
      }
      expect(mockListUserInvitations).not.toHaveBeenCalled();
    });

    it("returns UNAUTHENTICATED when session has no email", async () => {
      getSessionMock.mockResolvedValueOnce({
        user: { id: "u1", email: null, tenants: [] },
        expires: new Date(Date.now() + 3600_000).toISOString(),
      });

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNAUTHENTICATED");
      }
      expect(mockListUserInvitations).not.toHaveBeenCalled();
    });
  });

  describe("email isolation — never leaks other users invitations", () => {
    it("always passes the session email to the adapter, not any caller-supplied value", async () => {
      const sessionEmail = "alice@example.com";
      getSessionMock.mockResolvedValueOnce(makeSession(sessionEmail));
      mockListUserInvitations.mockResolvedValueOnce([]);

      await listPendingInvitationsAction();

      // The adapter must be called with exactly the session's email.
      expect(mockListUserInvitations).toHaveBeenCalledTimes(1);
      expect(mockListUserInvitations).toHaveBeenCalledWith(sessionEmail);
    });
  });

  describe("pending, non-expired invitations are returned", () => {
    it("returns a well-formed invitation for a valid pending invitation", async () => {
      getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
      const inv = makeInvitation();
      mockListUserInvitations.mockResolvedValueOnce([inv]);

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitations).toHaveLength(1);
        const out = result.invitations[0];
        expect(out.id).toBe("inv-1");
        expect(out.organizationId).toBe("org-1");
        expect(out.organizationName).toBe("Acme Corp");
        expect(out.role).toBe("member");
        expect(out.inviter?.email).toBe("boss@acme.io");
        // expiresAt must be a valid ISO string.
        expect(() => new Date(out.expiresAt)).not.toThrow();
        expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("handles string-typed expiresAt from older driver versions", async () => {
      getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
      const inv = makeInvitation({ expiresAt: futureDate().toISOString() });
      mockListUserInvitations.mockResolvedValueOnce([inv]);

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitations).toHaveLength(1);
      }
    });
  });

  describe("expired invitations are excluded", () => {
    it("filters out invitations where expiresAt is in the past", async () => {
      getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
      const inv = makeInvitation({ expiresAt: pastDate() });
      mockListUserInvitations.mockResolvedValueOnce([inv]);

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitations).toHaveLength(0);
      }
    });
  });

  describe("non-pending statuses are excluded", () => {
    it.each(["accepted", "rejected", "canceled"])(
      "filters out %s invitations",
      async (status) => {
        getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
        const inv = makeInvitation({ status });
        mockListUserInvitations.mockResolvedValueOnce([inv]);

        const result = await listPendingInvitationsAction();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.invitations).toHaveLength(0);
        }
      },
    );
  });

  describe("mixed results", () => {
    it("returns only the pending non-expired subset when given a mix", async () => {
      getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
      mockListUserInvitations.mockResolvedValueOnce([
        makeInvitation({ id: "inv-pending-valid", status: "pending", expiresAt: futureDate() }),
        makeInvitation({ id: "inv-expired", status: "pending", expiresAt: pastDate() }),
        makeInvitation({ id: "inv-accepted", status: "accepted", expiresAt: futureDate() }),
        makeInvitation({ id: "inv-rejected", status: "rejected", expiresAt: futureDate() }),
        makeInvitation({ id: "inv-canceled", status: "canceled", expiresAt: futureDate() }),
      ]);

      const result = await listPendingInvitationsAction();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitations).toHaveLength(1);
        expect(result.invitations[0].id).toBe("inv-pending-valid");
      }
    });
  });

  describe("adapter failure — graceful degradation", () => {
    it("returns ok with empty array when the adapter throws", async () => {
      getSessionMock.mockResolvedValueOnce(makeSession("alice@example.com"));
      mockListUserInvitations.mockRejectedValueOnce(new Error("DB timeout"));

      const result = await listPendingInvitationsAction();

      // Must NOT propagate the error — invitations are an optional affordance.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitations).toHaveLength(0);
      }
    });
  });
});
