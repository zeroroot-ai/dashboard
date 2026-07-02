import { describe, it, expect, vi, beforeEach } from "vitest";

// The action authorizes via the AuthRegistry (GetMissionAudit, member relation)
// through assertAuthorized. Mock it to model allowed vs denied callers.
const assertAuthorizedMock = vi.fn();
vi.mock("@/src/lib/auth/assert-authorized", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/auth/assert-authorized")>();
  return {
    ...actual, // keep the real AuthzDeniedError class
    assertAuthorized: (...args: unknown[]) => assertAuthorizedMock(...args),
  };
});

const getMissionAuditMock = vi.fn();
vi.mock("@/src/lib/gibson-client/secrets", () => ({
  getMissionAudit: (...args: unknown[]) => getMissionAuditMock(...args),
}));

import { fetchMissionAudit } from "../secrets-panel-action";
import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";

describe("fetchMissionAudit authorization (#616)", () => {
  beforeEach(() => {
    assertAuthorizedMock.mockReset();
    getMissionAuditMock.mockReset();
  });

  it("returns the audit for an authorized (member) caller", async () => {
    assertAuthorizedMock.mockResolvedValueOnce(undefined);
    getMissionAuditMock.mockResolvedValueOnce({
      accesses: [{ secretRef: "ref-1" }],
      aggregationLagSeconds: 3,
    });

    const r = await fetchMissionAudit("mission-1");

    expect(assertAuthorizedMock).toHaveBeenCalledWith(
      "/gibson.tenant.v1.SecretsService/GetMissionAudit",
    );
    expect(r.accesses).toHaveLength(1);
    expect(r.aggregationLagSeconds).toBe(3);
  });

  it("throws permission_denied for an unauthorized caller and never hits the daemon", async () => {
    assertAuthorizedMock.mockRejectedValueOnce(
      new AuthzDeniedError(
        "/gibson.tenant.v1.SecretsService/GetMissionAudit",
        "relation-not-met",
      ),
    );

    await expect(fetchMissionAudit("mission-1")).rejects.toThrow(
      "permission_denied",
    );
    expect(getMissionAuditMock).not.toHaveBeenCalled();
  });
});
