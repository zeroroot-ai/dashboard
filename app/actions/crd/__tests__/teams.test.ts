// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tests for listTeamsAction / listTeamMembersAction (dashboard#107
 * follow-up).
 *
 * Both used a hand-rolled `do { ... } while (pageToken)` loop with no
 * defense against a stuck daemon cursor. Proven here against a fake
 * MembershipService client that repeats a token, the same fake-daemon shape
 * the incident asked for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrdSession: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1" } },
    userId: "u1",
    tenantName: "acme",
  })),
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
}));

vi.mock("../_authz", () => ({
  requireCrdSession: mocks.requireCrdSession,
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({
    listTeams: mocks.listTeams,
    listTeamMembers: mocks.listTeamMembers,
  })),
}));

vi.mock("@/src/lib/auth/active-tenant", () => ({
  requireActiveTenant: vi.fn(async () => "t1"),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { listTeamsAction, listTeamMembersAction } from "../teams";
import { logger } from "@/src/lib/logger";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCrdSession.mockResolvedValue({
    ok: true,
    session: { user: { id: "u1" } },
    userId: "u1",
    tenantName: "acme",
  });
});

describe("listTeamsAction", () => {
  it("walks every page and returns the full team list", async () => {
    mocks.listTeams
      .mockResolvedValueOnce({
        teams: [{ id: "red", displayName: "Red Team", memberCount: 3 }],
        nextPageToken: "p2",
      })
      .mockResolvedValueOnce({
        teams: [{ id: "blue", displayName: "Blue Team", memberCount: 2 }],
        nextPageToken: "",
      });

    const result = await listTeamsAction();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.map((t) => t.id)).toEqual(["red", "blue"]);
    }
    expect(mocks.listTeams).toHaveBeenCalledTimes(2);
  });

  it("stops instead of looping forever when the daemon repeats the same page token (dashboard#107)", async () => {
    mocks.listTeams
      .mockResolvedValueOnce({
        teams: [{ id: "red", displayName: "Red Team", memberCount: 3 }],
        nextPageToken: "stuck",
      })
      // A real daemon bug: same token, same page, forever, if nothing stops it.
      .mockResolvedValue({
        teams: [{ id: "red", displayName: "Red Team", memberCount: 3 }],
        nextPageToken: "stuck",
      });

    const result = await listTeamsAction();

    expect(result.ok).toBe(true);
    // Bounded (one extra page tolerated while the repeat is detected), never
    // the unbounded call count a pre-fix build would make.
    expect(mocks.listTeams).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "repeated_token", rpc: "MembershipService.ListTeams" }),
      expect.any(String),
    );
  });
});

describe("listTeamMembersAction", () => {
  it("stops instead of looping forever when the daemon repeats the same page token (dashboard#107)", async () => {
    mocks.listTeamMembers.mockResolvedValue({
      members: [{ userId: "u1", email: "a@example.com", displayName: "A", isAdmin: false }],
      nextPageToken: "stuck",
    });

    const result = await listTeamMembersAction("red");

    expect(result.ok).toBe(true);
    expect(mocks.listTeamMembers).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "repeated_token", rpc: "MembershipService.ListTeamMembers" }),
      expect.any(String),
    );
  });

  it("stops instead of looping forever when a page comes back empty but still carries a token", async () => {
    mocks.listTeamMembers
      .mockResolvedValueOnce({
        members: [{ userId: "u1", email: "a@example.com", displayName: "A", isAdmin: false }],
        nextPageToken: "p2",
      })
      .mockResolvedValue({ members: [], nextPageToken: "p3" });

    const result = await listTeamMembersAction("red");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.map((m) => m.userId)).toEqual(["u1"]);
    }
    expect(mocks.listTeamMembers).toHaveBeenCalledTimes(2);
  });
});
