import { describe, it, expect } from "vitest";

import { buildCliCommands } from "./commands";

describe("buildCliCommands", () => {
  it("fills login with the tenant slug and platform URL", () => {
    const cmds = buildCliCommands({
      tenantSlug: "anthonys-company",
      gibsonUrl: "https://api.zeroroot.ai:30443",
    });
    const login = cmds.find((c) => c.label === "Authenticate");
    expect(login?.command).toBe(
      "gibson login --gibson-url https://api.zeroroot.ai:30443 --tenant anthonys-company",
    );
  });

  it("works for a non-default platform URL", () => {
    const cmds = buildCliCommands({
      tenantSlug: "acme",
      gibsonUrl: "https://gibson.acme.internal",
    });
    expect(cmds[0].command).toBe(
      "gibson login --gibson-url https://gibson.acme.internal --tenant acme",
    );
  });

  it("strips a trailing slash from the platform URL", () => {
    const cmds = buildCliCommands({
      tenantSlug: "acme",
      gibsonUrl: "https://gibson.acme.internal/",
    });
    expect(cmds[0].command).toBe(
      "gibson login --gibson-url https://gibson.acme.internal --tenant acme",
    );
  });

  it("returns the login → enroll → register → inspect sequence in order", () => {
    const cmds = buildCliCommands({
      tenantSlug: "t",
      gibsonUrl: "https://x",
    });
    expect(cmds.map((c) => c.command)).toEqual([
      "gibson login --gibson-url https://x --tenant t",
      "gibson agent enroll --name <name> --kind agent",
      "gibson component register --token <bootstrap-token>",
      "gibson inspect",
    ]);
    // Every command carries a label and a description.
    for (const c of cmds) {
      expect(c.label).not.toHaveLength(0);
      expect(c.description).not.toHaveLength(0);
    }
  });
});
