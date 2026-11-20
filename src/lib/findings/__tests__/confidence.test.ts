// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { compareConfidence, formatConfidence, isKnownConfidence } from "../confidence";

describe("confidence", () => {
  it("shows a known value as a whole percent", () => {
    expect(formatConfidence(0.854, "unknown")).toBe("85%");
    expect(formatConfidence(0, "unknown")).toBe("0%");
    expect(formatConfidence(1, "unknown")).toBe("100%");
  });

  it("shows a missing or invalid value as unknown, never as zero", () => {
    expect(formatConfidence(undefined, "unknown")).toBe("unknown");
    expect(formatConfidence(Number.NaN, "unknown")).toBe("unknown");
    expect(formatConfidence(2, "unknown")).toBe("unknown");
    expect(isKnownConfidence(-0.1)).toBe(false);
  });

  it("sorts known values and keeps unknown values last in both directions", () => {
    const values = [undefined, 0.5, 0.9, undefined, 0.1];
    expect([...values].sort((a, b) => compareConfidence(a, b, "asc"))).toEqual([
      0.1, 0.5, 0.9, undefined, undefined,
    ]);
    expect([...values].sort((a, b) => compareConfidence(a, b, "desc"))).toEqual([
      0.9, 0.5, 0.1, undefined, undefined,
    ]);
  });
});
