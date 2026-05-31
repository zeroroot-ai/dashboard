import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { NEW_MISSION_CUE, buildNewMissionCue } from "../new-mission-template";

describe("buildNewMissionCue (default-provider prepopulation)", () => {
  it("seeds the agent node's llmSlots block from a provider/model", () => {
    const cue = buildNewMissionCue({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(cue).toContain("llmSlots: [{");
    expect(cue).toContain('slot:     "primary"');
    expect(cue).toContain('provider: "anthropic"');
    expect(cue).toContain('model:    "claude-sonnet-4-5"');
  });

  it("omits the model line when no model is given", () => {
    const cue = buildNewMissionCue({ provider: "anthropic" });
    expect(cue).toContain('provider: "anthropic"');
    expect(cue).not.toContain("model:");
  });

  it("omits the llmSlots block entirely with no seed (inherit tenant default at run)", () => {
    expect(buildNewMissionCue()).not.toContain("llmSlots:");
    expect(NEW_MISSION_CUE).not.toContain("llmSlots:");
  });

  it("never emits the removed singular llm field regardless of seed", () => {
    const withSeed = buildNewMissionCue({ provider: "anthropic", model: "claude-opus-4-5" });
    // The singular `llm: { ... }` block was retired in sdk v0.128.0 (field 4).
    // llm_slots (field 5) is the replacement — as `llmSlots: [...]` in CUE.
    expect(withSeed).not.toMatch(/\bllm:\s*\{/);
    expect(NEW_MISSION_CUE).not.toMatch(/\bllm:\s*\{/);
  });

  it("seeds the primary slot even when provider is an empty string (valid fall-through marker)", () => {
    // An explicit empty provider is a valid fall-through per the proto contract
    // (sdk v0.128.0, LLMSlotConfig: empty provider = daemon resolves from tenant default).
    const cue = buildNewMissionCue({ provider: "" });
    expect(cue).toContain("llmSlots: [{");
    expect(cue).toContain('provider: ""');
  });
});

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

  it("does not emit the removed singular llm field (sdk v0.128.0, field 4 retired)", () => {
    expect(NEW_MISSION_CUE).not.toMatch(/\bllm:\s*\{/);
  });
});
