/**
 * Schema boundary tests. Each schema exercised with happy path + every
 * documented rejection case from Requirement 4.
 */

import { describe, it, expect } from "vitest";

import { planIDs } from "@/src/generated/plans";
import {
  dns1123Label,
  emailSchema,
  componentKindSchema,
  componentRefSchema,
  memberRoleSchema,
  tenantTierSchema,
  agentModeSchema,
  displayNameSchema,
  provisionTenantInput,
  deleteTenantInput,
  updateTenantInput,
  grantComponentInput,
  revokeGrantInput,
  inviteMemberInput,
  acceptInvitationInput,
  revokeMemberInput,
  resendInvitationInput,
  createEnrollmentInput,
  revokeEnrollmentInput,
  fetchBootstrapTokenInput,
} from "../schemas";

describe("dns1123Label", () => {
  it("accepts a valid label", () => {
    expect(dns1123Label.safeParse("my-tenant-1").success).toBe(true);
  });
  it("accepts a single character", () => {
    expect(dns1123Label.safeParse("a").success).toBe(true);
  });
  it("accepts 63 characters (max)", () => {
    expect(dns1123Label.safeParse("a".repeat(63)).success).toBe(true);
  });
  it("rejects 64 characters (over max)", () => {
    expect(dns1123Label.safeParse("a".repeat(64)).success).toBe(false);
  });
  it("rejects empty string", () => {
    expect(dns1123Label.safeParse("").success).toBe(false);
  });
  it("rejects leading hyphen", () => {
    expect(dns1123Label.safeParse("-tenant").success).toBe(false);
  });
  it("rejects trailing hyphen", () => {
    expect(dns1123Label.safeParse("tenant-").success).toBe(false);
  });
  it("rejects uppercase", () => {
    expect(dns1123Label.safeParse("Tenant").success).toBe(false);
  });
  it("rejects underscore", () => {
    expect(dns1123Label.safeParse("my_tenant").success).toBe(false);
  });
  it("rejects dot", () => {
    expect(dns1123Label.safeParse("my.tenant").success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("accepts a normal address", () => {
    expect(emailSchema.safeParse("alice@example.com").success).toBe(true);
  });
  it("rejects CR byte", () => {
    expect(emailSchema.safeParse("alice\r@example.com").success).toBe(false);
  });
  it("rejects LF byte", () => {
    expect(emailSchema.safeParse("alice\n@example.com").success).toBe(false);
  });
  it("rejects NUL byte", () => {
    expect(emailSchema.safeParse("alice\u0000@example.com").success).toBe(false);
  });
  it("rejects empty string", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });
  it("rejects addresses missing @", () => {
    expect(emailSchema.safeParse("alice.example.com").success).toBe(false);
  });
});

describe("componentKindSchema", () => {
  it("accepts known kinds", () => {
    expect(componentKindSchema.safeParse("agent").success).toBe(true);
    expect(componentKindSchema.safeParse("tool").success).toBe(true);
    expect(componentKindSchema.safeParse("plugin").success).toBe(true);
  });
  it("rejects unknown kind", () => {
    expect(componentKindSchema.safeParse("bot").success).toBe(false);
  });
  it("rejects uppercase kind", () => {
    expect(componentKindSchema.safeParse("Agent").success).toBe(false);
  });
});

describe("componentRefSchema (strict)", () => {
  it("accepts a valid ref", () => {
    const r = componentRefSchema.safeParse({ kind: "tool", name: "nmap" });
    expect(r.success).toBe(true);
  });
  it("rejects unknown extra key", () => {
    const r = componentRefSchema.safeParse({ kind: "tool", name: "nmap", extra: 1 });
    expect(r.success).toBe(false);
  });
  it("rejects name with uppercase", () => {
    const r = componentRefSchema.safeParse({ kind: "tool", name: "Nmap" });
    expect(r.success).toBe(false);
  });
});

describe("displayNameSchema", () => {
  it("accepts unicode and spaces", () => {
    expect(displayNameSchema.safeParse("Acme Corp, Øst 2026").success).toBe(true);
  });
  it("rejects empty", () => {
    expect(displayNameSchema.safeParse("").success).toBe(false);
  });
  it("rejects CR", () => {
    expect(displayNameSchema.safeParse("Acme\rCo").success).toBe(false);
  });
  it("rejects 129 chars", () => {
    expect(displayNameSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("memberRoleSchema", () => {
  it.each(["admin", "member"])("accepts %s", (r) => {
    expect(memberRoleSchema.safeParse(r).success).toBe(true);
  });
  it("rejects 'owner'", () => {
    expect(memberRoleSchema.safeParse("owner").success).toBe(false);
  });
  it("rejects 'viewer'", () => {
    expect(memberRoleSchema.safeParse("viewer").success).toBe(false);
  });
});

describe("tenantTierSchema", () => {
  it.each(planIDs)("accepts %s", (t) => {
    expect(tenantTierSchema.safeParse(t).success).toBe(true);
  });
  it.each(["free", "pro", "solo", "paid"])(
    "rejects deprecated/unknown tier %s",
    (t) => {
      expect(tenantTierSchema.safeParse(t).success).toBe(false);
    },
  );
});

describe("agentModeSchema", () => {
  it.each(["autonomous", "supervised"])("accepts %s", (m) => {
    expect(agentModeSchema.safeParse(m).success).toBe(true);
  });
  it("rejects 'manual'", () => {
    expect(agentModeSchema.safeParse("manual").success).toBe(false);
  });
});

describe("provisionTenantInput", () => {
  it("accepts minimal happy path", () => {
    const r = provisionTenantInput.safeParse({ displayName: "Acme", owner: "user-1" });
    expect(r.success).toBe(true);
  });
  it("accepts with tier", () => {
    const r = provisionTenantInput.safeParse({ displayName: "Acme", owner: "user-1", tier: planIDs[0] });
    expect(r.success).toBe(true);
  });
  it("rejects extra key", () => {
    const r = provisionTenantInput.safeParse({ displayName: "Acme", owner: "u", foo: 1 });
    expect(r.success).toBe(false);
  });
  it("rejects empty owner", () => {
    const r = provisionTenantInput.safeParse({ displayName: "Acme", owner: "" });
    expect(r.success).toBe(false);
  });
});

describe("deleteTenantInput", () => {
  it("accepts matching confirmation", () => {
    const r = deleteTenantInput.safeParse({ name: "acme", confirmationText: "acme" });
    expect(r.success).toBe(true);
  });
  it("rejects non-matching confirmation", () => {
    const r = deleteTenantInput.safeParse({ name: "acme", confirmationText: "nope" });
    expect(r.success).toBe(false);
  });
  it("rejects invalid tenant name", () => {
    const r = deleteTenantInput.safeParse({ name: "Acme", confirmationText: "Acme" });
    expect(r.success).toBe(false);
  });
});

describe("updateTenantInput", () => {
  it("accepts partial patch", () => {
    const r = updateTenantInput.safeParse({ name: "acme", patch: { tier: planIDs[0] } });
    expect(r.success).toBe(true);
  });
  it("rejects extra key on patch", () => {
    const r = updateTenantInput.safeParse({ name: "acme", patch: { tier: "platform", foo: 1 } });
    expect(r.success).toBe(false);
  });
});

describe("grantComponentInput", () => {
  it("accepts valid grant", () => {
    const r = grantComponentInput.safeParse({
      tenantName: "acme",
      componentRef: { kind: "tool", name: "nmap" },
    });
    expect(r.success).toBe(true);
  });
  it("rejects unknown source", () => {
    const r = grantComponentInput.safeParse({
      tenantName: "acme",
      componentRef: { kind: "tool", name: "nmap" },
      source: "god",
    });
    expect(r.success).toBe(false);
  });
});

describe("revokeGrantInput", () => {
  it("accepts valid revoke", () => {
    const r = revokeGrantInput.safeParse({
      tenantName: "acme",
      componentRef: { kind: "plugin", name: "slack" },
    });
    expect(r.success).toBe(true);
  });
});

describe("inviteMemberInput", () => {
  it("accepts valid invite", () => {
    const r = inviteMemberInput.safeParse({
      tenantName: "acme",
      email: "b@example.com",
      role: "member",
    });
    expect(r.success).toBe(true);
  });
  it("rejects control byte in email", () => {
    const r = inviteMemberInput.safeParse({
      tenantName: "acme",
      email: "b\n@example.com",
      role: "member",
    });
    expect(r.success).toBe(false);
  });
});

describe("acceptInvitationInput", () => {
  it("accepts a token (dashboard#715, token-based redemption)", () => {
    expect(acceptInvitationInput.safeParse({ token: "deadbeef" }).success).toBe(true);
  });
  it("rejects an empty token", () => {
    expect(acceptInvitationInput.safeParse({ token: "" }).success).toBe(false);
  });
});

describe("revokeMemberInput / resendInvitationInput", () => {
  it("accepts valid member / invitation references", () => {
    // Active member: userId + status.
    expect(
      revokeMemberInput.safeParse({ userId: "u1", email: "u1@example.com", status: "active" }).success,
    ).toBe(true);
    // Pending invitation: empty userId, email + invited status.
    expect(
      revokeMemberInput.safeParse({ userId: "", email: "pending@example.com", status: "invited" }).success,
    ).toBe(true);
    expect(
      resendInvitationInput.safeParse({ email: "pending@example.com" }).success,
    ).toBe(true);
  });
});

describe("createEnrollmentInput", () => {
  it("accepts minimal happy path", () => {
    const r = createEnrollmentInput.safeParse({
      tenantName: "acme",
      name: "agent-1",
      agentName: "breach-checker",
      mode: "autonomous",
    });
    expect(r.success).toBe(true);
  });
  it("accepts with grants", () => {
    const r = createEnrollmentInput.safeParse({
      tenantName: "acme",
      name: "agent-1",
      agentName: "breach-checker",
      mode: "supervised",
      componentGrants: [{ kind: "tool", name: "nmap" }],
      notes: "test",
    });
    expect(r.success).toBe(true);
  });
  it("rejects notes over 1024", () => {
    const r = createEnrollmentInput.safeParse({
      tenantName: "acme",
      name: "agent-1",
      agentName: "breach-checker",
      mode: "autonomous",
      notes: "x".repeat(1025),
    });
    expect(r.success).toBe(false);
  });
});

describe("revokeEnrollmentInput / fetchBootstrapTokenInput", () => {
  it("accepts valid reference", () => {
    expect(
      revokeEnrollmentInput.safeParse({ tenantName: "acme", name: "agent-1" }).success,
    ).toBe(true);
    expect(
      fetchBootstrapTokenInput.safeParse({ tenantName: "acme", name: "agent-1" }).success,
    ).toBe(true);
  });
});
