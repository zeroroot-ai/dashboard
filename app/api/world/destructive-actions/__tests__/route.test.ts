// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Per-route contract test for /api/world/destructive-actions — the ADR-0028
 * destructive-action authorization queue (dashboard#99). The backend client
 * (src/lib/destructive-actions/client.ts) is swapped per-test via its
 * test-only seam, so this is a pure route contract: GET maps the queue
 * (including the "backend not wired" case), POST validates + forwards the
 * decision, plus the 401/400/503 paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  __setDestructiveActionsClientForTest,
  __resetDestructiveActionsClientForTest,
  DestructiveActionsBackendUnavailableError,
  type DestructiveActionsClient,
} from "@/src/lib/destructive-actions/client";
import type { PendingDestructiveAction } from "@/src/types/destructive-actions";

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

// CSRF is enforced by this route (src/lib/auth/csrf.ts). Stubbed to pass here
// so these cases keep testing what they are about; the gate itself is covered,
// unmocked and per route, in app/api/__tests__/csrf-coverage.test.ts.
vi.mock("@/src/lib/auth/csrf", () => ({
  requireCsrf: vi.fn(async () => undefined),
  CsrfError: class CsrfError extends Error {},
  csrfErrorResponse: (err: Error) =>
    new Response(JSON.stringify({ error: "csrf-token-required", reason: err.message }), {
      status: 403,
    }),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("server-only", () => ({}));

import { GET, POST } from "../route";

const SESSION = { user: { id: "u1", tenantId: "t1" } };

const SAMPLE: PendingDestructiveAction = {
  id: "hyp-1:0",
  missionId: "m1",
  scopeId: "s1",
  hypothesisId: "hyp-1",
  claim: "port 6443 is unauthenticated",
  technique: "http-probe",
  predicateType: "status_code",
  predicateParams: { expect: 200 },
  action: "Send an authenticated request without credentials",
  blastRadius: "single host: 10.0.0.5",
  reversible: true,
  reversibilityNote: "read-only probe",
  requestedAt: "2026-09-28T00:00:00.000Z",
};

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/world/destructive-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
});

afterEach(() => {
  __resetDestructiveActionsClientForTest();
});

describe("GET /api/world/destructive-actions", () => {
  it("maps the pending queue when the backend is wired", async () => {
    const fake: DestructiveActionsClient = {
      listPending: vi.fn(async () => [SAMPLE]),
      decide: vi.fn(),
    };
    __setDestructiveActionsClientForTest(fake);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(SAMPLE);
  });

  it("reports available:false (not an error) when the backend is not wired", async () => {
    const fake: DestructiveActionsClient = {
      listPending: vi.fn(async () => {
        throw new DestructiveActionsBackendUnavailableError();
      }),
      decide: vi.fn(),
    };
    __setDestructiveActionsClientForTest(fake);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.items).toEqual([]);
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/world/destructive-actions", () => {
  it("forwards a valid approve decision", async () => {
    const decide = vi.fn(async () => undefined);
    __setDestructiveActionsClientForTest({ listPending: vi.fn(), decide });

    const res = await POST(postReq({ id: "hyp-1:0", decision: "approve" }));
    expect(res.status).toBe(200);
    expect(decide).toHaveBeenCalledWith("hyp-1:0", "approve", undefined);
  });

  it("forwards a valid deny decision with a reason", async () => {
    const decide = vi.fn(async () => undefined);
    __setDestructiveActionsClientForTest({ listPending: vi.fn(), decide });

    const res = await POST(
      postReq({ id: "hyp-1:0", decision: "deny", reason: "too risky right now" }),
    );
    expect(res.status).toBe(200);
    expect(decide).toHaveBeenCalledWith("hyp-1:0", "deny", "too risky right now");
  });

  it("400 on an unknown decision (fail-closed)", async () => {
    const decide = vi.fn();
    __setDestructiveActionsClientForTest({ listPending: vi.fn(), decide });
    const res = await POST(postReq({ id: "hyp-1:0", decision: "maybe" }));
    expect(res.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("400 on a missing id", async () => {
    const decide = vi.fn();
    __setDestructiveActionsClientForTest({ listPending: vi.fn(), decide });
    const res = await POST(postReq({ decision: "approve" }));
    expect(res.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("503 when the backend is not wired", async () => {
    const decide = vi.fn(async () => {
      throw new DestructiveActionsBackendUnavailableError();
    });
    __setDestructiveActionsClientForTest({ listPending: vi.fn(), decide });

    const res = await POST(postReq({ id: "hyp-1:0", decision: "approve" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("BACKEND_NOT_WIRED");
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(postReq({ id: "hyp-1:0", decision: "approve" }));
    expect(res.status).toBe(401);
  });
});
