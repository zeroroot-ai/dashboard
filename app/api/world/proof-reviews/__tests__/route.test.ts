// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Route contract test for /api/world/proof-reviews (dashboard#228). The
 * WorldService client is mocked, so this proves the 401 path, the page token
 * forwarding and the mapping of the page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetServerSession, mockListProofReviews } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockListProofReviews: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({ listProofReviews: mockListProofReviews }),
}));

import { GET } from "../route";

function req(qs = ""): NextRequest {
  return new NextRequest(`http://test.local/api/world/proof-reviews${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", tenantId: "t1" } });
});

describe("GET /api/world/proof-reviews", () => {
  it("refuses a caller with no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListProofReviews).not.toHaveBeenCalled();
  });

  it("maps one page of proofs with their evidence", async () => {
    mockListProofReviews.mockResolvedValue({
      reviews: [
        {
          hypothesisId: "hyp-1",
          missionId: "m-1",
          scopeId: "s-1",
          technique: "T1190",
          evidence: [{ type: "http_response", title: "the admin page", content: "200 OK" }],
          submittedAtUnixNano: BigInt("1700000000000000000"),
        },
      ],
      nextPageToken: "next",
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockListProofReviews).toHaveBeenCalledWith({ pageSize: 50, pageToken: "" });
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          hypothesisId: "hyp-1",
          missionId: "m-1",
          scopeId: "s-1",
          technique: "T1190",
          evidence: [{ type: "http_response", title: "the admin page", content: "200 OK" }],
          submittedAt: "2023-11-14T22:13:20.000Z",
        },
      ],
      nextPageToken: "next",
    });
  });

  it("forwards the page token and leaves an unknown time empty", async () => {
    mockListProofReviews.mockResolvedValue({
      reviews: [
        {
          hypothesisId: "hyp-2",
          missionId: "",
          scopeId: "",
          technique: "",
          evidence: [],
          submittedAtUnixNano: BigInt(0),
        },
      ],
      nextPageToken: "",
    });
    const res = await GET(req("?pageToken=abc"));
    expect(mockListProofReviews).toHaveBeenCalledWith({ pageSize: 50, pageToken: "abc" });
    const body = await res.json();
    expect(body.items[0].submittedAt).toBe("");
    expect(body.nextPageToken).toBe("");
  });

  it("refuses a page token that is too long", async () => {
    const res = await GET(req(`?pageToken=${"a".repeat(1025)}`));
    expect(res.status).toBe(400);
    expect(mockListProofReviews).not.toHaveBeenCalled();
  });
});
