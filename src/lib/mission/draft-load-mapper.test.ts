import { describe, it, expect } from "vitest";

import { loadLegacyDraft } from "./draft-load-mapper";

describe("loadLegacyDraft", () => {
  it("drops executionMode silently", () => {
    const out = loadLegacyDraft({
      mission: {
        name: "test",
        executionMode: "sequential",
      },
    });
    expect(out.definition.name).toBe("test");
    expect(
      (out.definition as Record<string, unknown>).executionMode,
    ).toBeUndefined();
    expect(out.droppedFields).toContain("mission.executionMode");
  });

  it("drops errorHandling silently", () => {
    const out = loadLegacyDraft({
      mission: {
        name: "test",
        errorHandling: { retryPolicy: { maxRetries: 5 } },
      },
    });
    expect(out.droppedFields).toContain("mission.errorHandling");
  });

  it("drops guardrails.confirmationRequired silently", () => {
    const out = loadLegacyDraft({
      mission: { name: "test" },
      guardrails: { confirmationRequired: [{ rule: "x" }] },
    });
    expect(out.droppedFields).toContain("guardrails.confirmationRequired");
  });

  it("lifts guardrails.maxTokensPerCall into constraints", () => {
    const out = loadLegacyDraft({
      mission: { name: "test" },
      guardrails: { maxTokensPerCall: 1024 },
    });
    expect(out.constraints.maxTokensPerCall).toBe(1024);
  });

  it("preserves UI state", () => {
    const out = loadLegacyDraft({
      mission: { name: "test" },
      ui: { activeTab: "steps", draftId: "d-123", sourceTemplateId: "recon" },
    });
    expect(out.ui.activeTab).toBe("steps");
    expect(out.ui.draftId).toBe("d-123");
    expect(out.ui.sourceTemplateId).toBe("recon");
  });

  it("returns empty draft for empty input", () => {
    const out = loadLegacyDraft(null);
    expect(out.definition).toEqual({});
    expect(out.constraints).toEqual({});
    expect(out.droppedFields).toEqual([]);
  });

  it("handles top-level mission shape (no nested mission key)", () => {
    const out = loadLegacyDraft({
      name: "flat-test",
      version: "1.0.0",
    });
    expect(out.definition.name).toBe("flat-test");
    expect(out.definition.version).toBe("1.0.0");
  });

  it("falls back to target_ref when targetRef missing", () => {
    const out = loadLegacyDraft({ mission: { target_ref: "tgt-1" } });
    expect(out.definition.targetRef).toBe("tgt-1");
  });
});
