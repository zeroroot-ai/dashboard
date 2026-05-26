/**
 * Unit tests for the GET /api/auth/tenant-available route (dashboard#44).
 *
 *   - existing Tenant CR → `available: false`
 *   - K8sNotFoundError → `available: true`
 *   - K8s API failure → `available: null` with reason `lookup_failed`
 *     (degraded; client renders no inline state, submit-time server
 *     action is authoritative)
 *   - empty / too-short slug → `available: null` with reason `empty`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { K8sNotFoundError, K8sUnavailableError } from "@/src/lib/k8s/errors";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getTenantImpl = vi.fn();
vi.mock("@/src/lib/k8s/tenants", () => ({
  getTenant: vi.fn((name: string) => getTenantImpl(name)),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Now import the route handler (after mocks are registered).
import { GET } from "../route";

beforeEach(() => {
  getTenantImpl.mockReset();
});

function buildReq(name: string | null): NextRequest {
  const url = new URL("http://test/api/auth/tenant-available");
  if (name !== null) url.searchParams.set("name", name);
  return new NextRequest(url);
}

describe("GET /api/auth/tenant-available", () => {
  it("existing tenant → available: false", async () => {
    getTenantImpl.mockResolvedValue({ metadata: { name: "acme-security" } });

    const res = await GET(buildReq("Acme Security"));
    const body = await res.json();

    expect(body.available).toBe(false);
    expect(body.slug).toBe("acme-security");
    expect(getTenantImpl).toHaveBeenCalledWith("acme-security");
  });

  it("K8sNotFoundError → available: true (slug is free)", async () => {
    getTenantImpl.mockRejectedValue(
      new K8sNotFoundError('tenants.gibson.zeroroot.ai "acme-security" not found'),
    );

    const res = await GET(buildReq("Acme Security"));
    const body = await res.json();

    expect(body.available).toBe(true);
    expect(body.slug).toBe("acme-security");
  });

  it("other K8s error → available: null, reason: lookup_failed (degrade)", async () => {
    getTenantImpl.mockRejectedValue(new K8sUnavailableError("apiserver down"));

    const res = await GET(buildReq("Acme Security"));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("lookup_failed");
  });

  it("empty name → available: null, reason: empty (no fetch)", async () => {
    const res = await GET(buildReq(""));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("empty");
    expect(getTenantImpl).not.toHaveBeenCalled();
  });

  it("name slugifies to single char → available: null, reason: empty", async () => {
    const res = await GET(buildReq("!"));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("empty");
    expect(getTenantImpl).not.toHaveBeenCalled();
  });

  it("missing query param → available: null, reason: empty", async () => {
    const res = await GET(buildReq(null));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("empty");
  });
});
