// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import {
  COLLAPSE_CHARS,
  COLLAPSE_LINES,
  collapsedEvidence,
  evidenceKindLabel,
  evidenceTierLabel,
  isLongEvidence,
} from "../evidence";

describe("evidenceTierLabel", () => {
  it("uses the two labels of the product", () => {
    expect(evidenceTierLabel("recorded")).toBe("Recorded by Gibson");
    expect(evidenceTierLabel("typed")).toBe("Typed by the agent");
  });
  it("does not claim a source when the tier is missing", () => {
    expect(evidenceTierLabel("unknown")).toBe("Source not stated");
  });
});

describe("evidenceKindLabel", () => {
  it("labels each of the nine types", () => {
    expect(evidenceKindLabel("conversation")).toBe("Conversation");
    expect(evidenceKindLabel("network_trace")).toBe("Network trace");
    expect(evidenceKindLabel("payload")).toBe("Payload");
    expect(evidenceKindLabel("request")).toBe("Request");
    expect(evidenceKindLabel("unspecified")).toBe("Evidence");
  });
});

describe("collapse", () => {
  it("keeps a short content whole", () => {
    expect(isLongEvidence("a\nb")).toBe(false);
    expect(isLongEvidence("x".repeat(COLLAPSE_CHARS))).toBe(false);
  });

  it("collapses a content with many lines, and keeps the first lines", () => {
    const text = Array.from({ length: COLLAPSE_LINES + 5 }, (_, i) => `line ${i}`).join("\n");
    expect(isLongEvidence(text)).toBe(true);
    const head = collapsedEvidence(text);
    expect(head.split("\n")).toHaveLength(COLLAPSE_LINES);
    expect(head.startsWith("line 0")).toBe(true);
  });

  it("collapses a long single line at the character limit", () => {
    const text = "y".repeat(COLLAPSE_CHARS + 500);
    expect(isLongEvidence(text)).toBe(true);
    expect(collapsedEvidence(text)).toHaveLength(COLLAPSE_CHARS);
  });
});
