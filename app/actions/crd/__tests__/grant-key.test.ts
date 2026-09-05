import { describe, it, expect } from "vitest";
import { componentKey } from "../component-key";

// The daemon keys catalog tuples on component:<kind>/<name> (gibson#1584,
// ADR-0015). A dash here put tenant_enabled on an object nothing reads.
describe("componentKey", () => {
  it("spells the ref as <kind>/<name>", () => {
    expect(componentKey({ kind: "agent", name: "zerocool-claude" })).toBe("agent/zerocool-claude");
    expect(componentKey({ kind: "tool", name: "nmap" })).toBe("tool/nmap");
  });
});
