import { describe, it, expect } from "vitest";

import { validateMissionYaml } from "./yaml-schema-validator";

describe("validateMissionYaml", () => {
  it("returns empty for empty input", () => {
    expect(validateMissionYaml("")).toEqual([]);
    expect(validateMissionYaml("   \n  ")).toEqual([]);
  });

  it("flags malformed YAML with a non-zero line where possible", () => {
    const errs = validateMissionYaml("nodes: [unclosed");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].severity).toBe("error");
  });

  it("accepts a minimal well-formed mission", () => {
    const yaml = `
name: minimal
nodes:
  step1:
    id: step1
    type: NODE_TYPE_AGENT
    agentConfig:
      agentName: test-agent
`;
    const errs = validateMissionYaml(yaml);
    // Schema may surface format-level warnings but should not
    // produce hard errors on a valid minimal mission.
    const hardErrors = errs.filter((e) => e.severity === "error");
    expect(hardErrors).toEqual([]);
  });

  it("flags unknown top-level field as a schema violation", () => {
    const yaml = `
name: x
nodes: {}
not_a_real_field: oops
`;
    const errs = validateMissionYaml(yaml);
    // Generated schema sets additionalProperties: false on the
    // root object, so unknown fields surface as errors.
    expect(errs.length).toBeGreaterThan(0);
  });
});
