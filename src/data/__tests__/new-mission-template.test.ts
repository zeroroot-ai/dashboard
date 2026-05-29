import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { NEW_MISSION_CUE } from "../new-mission-template";

/**
 * The New Mission default must compile cleanly via ValidateMissionCUE so Run is
 * enabled the instant the editor opens (dashboard#492). CUE compilation happens
 * daemon-side, so this suite cannot evaluate the source directly; instead it
 * locks the template to the same schema-bound structure as the shipped
 * single-node template (secrets-audit), which the daemon already validates as
 * known-good. If the daemon validates secrets-audit clean, a structurally
 * congruent template validates clean too.
 */
describe("NEW_MISSION_CUE", () => {
  const knownGood = readFileSync(
    join(process.cwd(), "src/data/templates/secrets-audit.cue"),
    "utf-8",
  );

  it("binds the MissionDefinition schema via the same import as shipped templates", () => {
    const importLine =
      'import missionv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/mission/v1"';
    expect(knownGood).toContain(importLine);
    expect(NEW_MISSION_CUE).toContain(importLine);
    expect(NEW_MISSION_CUE).toContain("missionv1.#MissionDefinition & {");
  });

  it("declares every top-level field the schema-bound templates declare", () => {
    for (const field of ["name:", "description:", "version:", "targetRef:"]) {
      expect(NEW_MISSION_CUE).toContain(field);
    }
  });

  it("declares at least one agent node with id, type and agentName", () => {
    expect(NEW_MISSION_CUE).toContain("nodes:");
    expect(NEW_MISSION_CUE).toContain("type: missionv1.#NODE_TYPE_AGENT");
    expect(NEW_MISSION_CUE).toMatch(/id:\s+"assess"/);
    expect(NEW_MISSION_CUE).toMatch(/agentName:\s+"[^"]+"/);
  });

  it("wires entryPoints and exitPoints to a declared node id", () => {
    const ids = [...NEW_MISSION_CUE.matchAll(/id:\s+"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids.length).toBeGreaterThan(0);
    const entry = /entryPoints:\s*\[\s*"([^"]+)"/.exec(NEW_MISSION_CUE)?.[1];
    const exit = /exitPoints:\s*\[\s*"([^"]+)"/.exec(NEW_MISSION_CUE)?.[1];
    expect(entry).toBeDefined();
    expect(exit).toBeDefined();
    expect(ids).toContain(entry);
    expect(ids).toContain(exit);
  });

  it("does not regress to the old bare-package stub form", () => {
    // The pre-#492 stub used `package mission` with only name/description and
    // failed validation. Ensure we never ship that shape again.
    expect(NEW_MISSION_CUE).not.toMatch(/^\s*package mission\s*$/m);
  });
});
