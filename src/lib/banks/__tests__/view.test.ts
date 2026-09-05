import { describe, it, expect } from "vitest";
import { memberStateLabel, ownerLabel, shapeNeedsProviderConfig, staleLimitLabel } from "../view";
import { createBankSchema, updateBankSchema } from "../schema";
import { deriveBankPermissions } from "../permissions";

describe("memberStateLabel, the words the docs use", () => {
  it.each([
    [{ state: "idle", jobsInFlight: 0, cap: 2 }, "idle"],
    [{ state: "busy", jobsInFlight: 2, cap: 2 }, "busy 2/2"],
    [{ state: "needs_sign_in", jobsInFlight: 0, cap: 1 }, "needs sign-in"],
    [{ state: "draining", jobsInFlight: 1, cap: 1 }, "draining"],
    [{ state: "dead", jobsInFlight: 0, cap: 1 }, "dead"],
    [{ state: "launching", jobsInFlight: 0, cap: 1 }, "launching"],
    [{ state: "unknown", jobsInFlight: 0, cap: 1 }, "unknown"],
  ] as const)("%o -> %s", (m, label) => {
    expect(memberStateLabel(m)).toBe(label);
  });
});

describe("labels", () => {
  it("names the owner from the caller's point of view", () => {
    expect(ownerLabel({ kind: "user", id: "u1" }, "u1")).toBe("Me");
    expect(ownerLabel({ kind: "user", id: "u2" }, "u1")).toBe("User u2");
    expect(ownerLabel({ kind: "tenant", id: "t" }, "u1")).toBe("Tenant");
  });
  it("formats the stale limit", () => {
    expect(staleLimitLabel(null)).toBe("daemon default");
    expect(staleLimitLabel(0)).toBe("daemon default");
    expect(staleLimitLabel(2700)).toBe("45 min");
    expect(staleLimitLabel(7200)).toBe("2 h");
  });
  it("only the subscription shape needs no provider configuration", () => {
    expect(shapeNeedsProviderConfig("subscription")).toBe(false);
    expect(shapeNeedsProviderConfig("bedrock")).toBe(true);
    expect(shapeNeedsProviderConfig("anthropic_api_key")).toBe(true);
  });
});

const base = {
  name: "crew",
  tenantOwned: false,
  desiredCount: 2,
  loginShape: "subscription",
  providerConfigName: "",
  agentName: "claude",
  model: "",
  maxJobsInFlight: 1,
  staleLimitMinutes: 0,
  spillPolicy: "queue",
};

describe("createBankSchema mirrors the daemon store", () => {
  it("accepts a subscription bank owned by a person", () => {
    expect(createBankSchema.safeParse(base).success).toBe(true);
  });
  it("refuses a subscription bank owned by the tenant", () => {
    const r = createBankSchema.safeParse({ ...base, tenantOwned: true });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0].path).toEqual(["loginShape"]);
  });
  it("refuses a third-party shape with no provider configuration", () => {
    const r = createBankSchema.safeParse({ ...base, loginShape: "vertex" });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0].path).toEqual(["providerConfigName"]);
  });
  it("accepts a third-party shape with a provider configuration, tenant owned", () => {
    expect(createBankSchema.safeParse({ ...base, tenantOwned: true, loginShape: "bedrock", providerConfigName: "aws-prod" }).success).toBe(true);
  });
  it("refuses an empty name and a negative count", () => {
    expect(createBankSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(createBankSchema.safeParse({ ...base, desiredCount: -1 }).success).toBe(false);
  });
  it("coerces numbers from form strings", () => {
    const r = createBankSchema.safeParse({ ...base, desiredCount: "3", maxJobsInFlight: "2" });
    expect(r.success && r.data.desiredCount).toBe(3);
  });
  it("update accepts a partial", () => {
    expect(updateBankSchema.safeParse({ desiredCount: 4 }).success).toBe(true);
    expect(updateBankSchema.safeParse({ spillPolicy: "sideways" }).success).toBe(false);
  });
});

describe("deriveBankPermissions follows the FGA model", () => {
  it("the user owner manages and sends", () => {
    expect(deriveBankPermissions({ kind: "user", id: "u1" }, { userId: "u1", tenantRole: "member" })).toEqual({ canManage: true, canSend: true });
  });
  it("another member gets nothing the dashboard can vouch for", () => {
    expect(deriveBankPermissions({ kind: "user", id: "u1" }, { userId: "u2", tenantRole: "admin" })).toEqual({ canManage: false, canSend: false });
  });
  it("a tenant admin manages a tenant-owned bank, a member does not", () => {
    expect(deriveBankPermissions({ kind: "tenant", id: "t" }, { userId: "u2", tenantRole: "admin" }).canManage).toBe(true);
    expect(deriveBankPermissions({ kind: "tenant", id: "t" }, { userId: "u2", tenantRole: "owner" }).canManage).toBe(true);
    expect(deriveBankPermissions({ kind: "tenant", id: "t" }, { userId: "u2", tenantRole: "member" }).canManage).toBe(false);
  });
  it("no session, no rights", () => {
    expect(deriveBankPermissions({ kind: "user", id: "u1" }, { userId: null, tenantRole: null }).canManage).toBe(false);
  });
});
