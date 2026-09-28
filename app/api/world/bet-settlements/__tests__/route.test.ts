// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Per-route contract test for /api/world/bet-settlements — the ADR-0023 HITL
 * settle surface (dashboard#97). The backend client
 * (src/lib/hitl-settle/client.ts) is swapped per-test via its test-only seam,
 * so this is a pure route contract: GET maps the queue (including the
 * "backend not wired" case), POST validates + forwards the verdict, plus the
 * 401/400/503 paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  __setHitlSettleClientForTest,
  __resetHitlSettleClientForTest,
  HitlSettleBackendUnavailableError,
  type HitlSettleClient,
} from "@/src/lib/hitl-settle/client";
import type { OpenBetForReview } from "@/src/types/hitl-settle";

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

// CSRF is enforced by this route (src/lib/auth/csrf.ts). Stubbed to pass here
// so these cases keep testing what they are about; the gate itself is
// covered, unmocked and per route, in app/api/__tests__/csrf-coverage.test.ts.
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

const SAMPLE: OpenBetForReview = {
  id: "hyp-1",
  missionId: "m1",
  scopeId: "s1",
  hypothesisId: "hyp-1",
  claim: "port 6443 is unauthenticated",
  proposer: "recon-agent",
  confidence: 0.72,
  technique: "http-probe",
  evidence: [{ description: "200 OK with no Authorization header" }],
  runId: "run-1",
  requestedAt: "2026-09-28T00:00:00.000Z",
};

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/world/bet-settlements", {
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
  __resetHitlSettleClientForTest();
});

describe("GET /api/world/bet-settlements", () => {
  it("maps the OPEN-bet queue when the backend is wired", async () => {
    const fake: HitlSettleClient = {
      listOpenBets: vi.fn(async () => [SAMPLE]),
      submitVerdict: vi.fn(),
    };
    __setHitlSettleClientForTest(fake);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(SAMPLE);
  });

  it("reports available:false (not an error) when the backend is not wired", async () => {
    const fake: HitlSettleClient = {
      listOpenBets: vi.fn(async () => {
        throw new HitlSettleBackendUnavailableError();
      }),
      submitVerdict: vi.fn(),
    };
    __setHitlSettleClientForTest(fake);

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

describe("POST /api/world/bet-settlements", () => {
  it("forwards a valid true_positive verdict and returns the effect confirmation", async () => {
    const submitVerdict = vi.fn(async () => ({
      ok: true as const,
      settled: "true_positive" as const,
      didSettle: true,
      effect: "belief and reputation updated",
    }));
    __setHitlSettleClientForTest({ listOpenBets: vi.fn(), submitVerdict });

    const res = await POST(postReq({ id: "hyp-1", verdict: "true_positive" }));
    expect(res.status).toBe(200);
    expect(submitVerdict).toHaveBeenCalledWith("hyp-1", "true_positive", undefined);
    const body = await res.json();
    expect(body.effect).toBe("belief and reputation updated");
    expect(body.didSettle).toBe(true);
  });

  it("forwards a valid dismiss verdict with a category (label-only, does not settle)", async () => {
    const submitVerdict = vi.fn(async () => ({
      ok: true as const,
      settled: "dismiss" as const,
      didSettle: false,
      effect: "labeled dismiss; the bet remains open",
    }));
    __setHitlSettleClientForTest({ listOpenBets: vi.fn(), submitVerdict });

    const res = await POST(postReq({ id: "hyp-1", verdict: "dismiss", category: "duplicate" }));
    expect(res.status).toBe(200);
    expect(submitVerdict).toHaveBeenCalledWith("hyp-1", "dismiss", "duplicate");
  });

  it("400 on an unknown verdict (fail-closed)", async () => {
    const submitVerdict = vi.fn();
    __setHitlSettleClientForTest({ listOpenBets: vi.fn(), submitVerdict });
    const res = await POST(postReq({ id: "hyp-1", verdict: "maybe" }));
    expect(res.status).toBe(400);
    expect(submitVerdict).not.toHaveBeenCalled();
  });

  it("400 on a missing id", async () => {
    const submitVerdict = vi.fn();
    __setHitlSettleClientForTest({ listOpenBets: vi.fn(), submitVerdict });
    const res = await POST(postReq({ verdict: "true_positive" }));
    expect(res.status).toBe(400);
    expect(submitVerdict).not.toHaveBeenCalled();
  });

  it("503 when the backend is not wired", async () => {
    const submitVerdict = vi.fn(async () => {
      throw new HitlSettleBackendUnavailableError();
    });
    __setHitlSettleClientForTest({ listOpenBets: vi.fn(), submitVerdict });

    const res = await POST(postReq({ id: "hyp-1", verdict: "true_positive" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("BACKEND_NOT_WIRED");
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(postReq({ id: "hyp-1", verdict: "true_positive" }));
    expect(res.status).toBe(401);
  });
});
