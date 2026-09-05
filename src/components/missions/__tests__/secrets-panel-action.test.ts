import { describe, it, expect, vi, beforeEach } from "vitest";

// The action's authorization runs inside the userClient transport (per-RPC
// assertAuthorized bake-in, dashboard#848 / #902), so a denial surfaces as
// AuthzDeniedError thrown from INSIDE getMissionAudit. Mock the gibson-client
// wrapper to model allowed vs denied callers (dashboard#904).
const getMissionAuditMock = vi.fn();
vi.mock("@/src/lib/gibson-client/secrets", () => ({
  getMissionAudit: (...args: unknown[]) => getMissionAuditMock(...args),
}));

import { fetchMissionAudit } from "../secrets-panel-action";
import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";

describe("fetchMissionAudit authorization (#616)", () => {
  beforeEach(() => {
    getMissionAuditMock.mockReset();
  });

  it("returns the audit for an authorized (member) caller", async () => {
    getMissionAuditMock.mockResolvedValueOnce({
      accesses: [{ secretRef: "ref-1" }],
      aggregationLagSeconds: 3,
    });

    const r = await fetchMissionAudit("mission-1");

    expect(getMissionAuditMock).toHaveBeenCalledWith("mission-1");
    expect(r.accesses).toHaveLength(1);
    expect(r.aggregationLagSeconds).toBe(3);
  });

  it("throws permission_denied when the transport denies the RPC", async () => {
    getMissionAuditMock.mockRejectedValueOnce(
      new AuthzDeniedError(
        "/gibson.tenant.v1.SecretsService/GetMissionAudit",
        "relation-not-met",
      ),
    );

    await expect(fetchMissionAudit("mission-1")).rejects.toThrow(
      "permission_denied",
    );
  });

  it("rethrows non-authz errors untouched", async () => {
    getMissionAuditMock.mockRejectedValueOnce(new Error("daemon exploded"));

    await expect(fetchMissionAudit("mission-1")).rejects.toThrow(
      "daemon exploded",
    );
  });
});
