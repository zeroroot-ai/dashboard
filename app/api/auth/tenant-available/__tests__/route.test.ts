/**
 * Unit tests for the GET /api/auth/tenant-available route (dashboard#44).
 *
 * Post dashboard#855 the lookup goes through the daemon's
 * TenantProvisioningService (getTenantProvisioningStatus) instead of the
 * Kubernetes API — `found` is the availability signal:
 *
 *   - provisioning record exists (found: true) → `available: false`
 *   - no record (found: false) → `available: true`
 *   - daemon failure → `available: null` with reason `lookup_failed`
 *     (degraded; client renders no inline state, submit-time server
 *     action is authoritative)
 *   - empty / too-short slug → `available: null` with reason `empty`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getStatusImpl = vi.fn();
vi.mock("@/src/lib/gibson-client/provisioning", () => ({
  getTenantProvisioningStatus: (slug: string) => getStatusImpl(slug),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Now import the route handler (after mocks are registered).
import { GET } from "../route";

beforeEach(() => {
  getStatusImpl.mockReset();
});

function buildReq(name: string | null): NextRequest {
  const url = new URL("http://test/api/auth/tenant-available");
  if (name !== null) url.searchParams.set("name", name);
  return new NextRequest(url);
}

describe("GET /api/auth/tenant-available", () => {
  it("existing tenant (found: true) → available: false", async () => {
    getStatusImpl.mockResolvedValue({ found: true });

    const res = await GET(buildReq("Acme Security"));
    const body = await res.json();

    expect(body.available).toBe(false);
    expect(body.slug).toBe("acme-security");
    expect(getStatusImpl).toHaveBeenCalledWith("acme-security");
  });

  it("no provisioning record (found: false) → available: true (slug is free)", async () => {
    getStatusImpl.mockResolvedValue({ found: false });

    const res = await GET(buildReq("Acme Security"));
    const body = await res.json();

    expect(body.available).toBe(true);
    expect(body.slug).toBe("acme-security");
  });

  it("daemon error → available: null, reason: lookup_failed (degrade)", async () => {
    getStatusImpl.mockRejectedValue(new Error("daemon unavailable"));

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
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it("name slugifies to single char → available: null, reason: empty", async () => {
    const res = await GET(buildReq("!"));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("empty");
    expect(getStatusImpl).not.toHaveBeenCalled();
  });

  it("missing query param → available: null, reason: empty", async () => {
    const res = await GET(buildReq(null));
    const body = await res.json();

    expect(body.available).toBeNull();
    expect(body.reason).toBe("empty");
  });
});
