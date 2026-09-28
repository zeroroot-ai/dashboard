// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/src/test/test-utils";
import { useOpenBets, useSubmitBetVerdict } from "../useHitlSettle";
import type { OpenBetForReview } from "@/src/types/hitl-settle";

vi.mock("@/src/lib/auth/tenant", () => ({
  useTenantId: () => "test-tenant",
}));

vi.mock("@/src/lib/api/fetch", () => ({
  apiFetch: (...args: Parameters<typeof fetch>) => mockApiFetch(...args),
}));

const mockApiFetch = vi.fn();

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

describe("useOpenBets / useSubmitBetVerdict", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.resetAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("fetches the OPEN-bet queue from the real API route, not a fixture", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [SAMPLE], available: true }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useOpenBets(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/world/bet-settlements",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.data?.items).toEqual([SAMPLE]);
    expect(result.current.data?.available).toBe(true);
  });

  it("surfaces available:false when the backend is not wired, without treating it as an error", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [], available: false }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useOpenBets(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(false);
  });

  it("rejects on a non-2xx response", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Authentication required" } }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useOpenBets(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("useSubmitBetVerdict posts through apiFetch (CSRF-covered) and invalidates the queue", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, settled: "true_positive", didSettle: true, effect: "belief and reputation updated" }),
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSubmitBetVerdict(), { wrapper });
    const response = await result.current.mutateAsync({ id: "hyp-1", verdict: "true_positive" });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/world/bet-settlements",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "hyp-1", verdict: "true_positive" }),
      }),
    );
    expect(response.effect).toBe("belief and reputation updated");
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
