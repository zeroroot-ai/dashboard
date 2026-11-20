// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { formatUsd, medianFixCost, summarizeBudget } from "../budget-burn";

describe("summarizeBudget", () => {
  it("gives the spend, the limit and the share of the limit", () => {
    const b = summarizeBudget({
      currentSpendUsdCents: 2500,
      spendLimitUsdCents: 10000,
      periodResetAtUnix: 1_800_000_000,
      warningCrossed: false,
    });
    expect(b).toMatchObject({
      spentUsdCents: 2500,
      limitUsdCents: 10000,
      fraction: 0.25,
      warningCrossed: false,
      limitReached: false,
      resetAtMs: 1_800_000_000_000,
    });
  });

  it("treats a zero limit as no limit", () => {
    const b = summarizeBudget({
      currentSpendUsdCents: 500,
      spendLimitUsdCents: 0,
      periodResetAtUnix: 0,
      warningCrossed: false,
    });
    expect(b).toMatchObject({ limitUsdCents: null, fraction: null, limitReached: false, resetAtMs: null });
  });

  it("flags a spend that reaches the limit and caps the share at 1", () => {
    const b = summarizeBudget({
      currentSpendUsdCents: 12000,
      spendLimitUsdCents: 10000,
      periodResetAtUnix: 1,
      warningCrossed: true,
    });
    expect(b.limitReached).toBe(true);
    expect(b.fraction).toBe(1);
    expect(b.warningCrossed).toBe(true);
  });
});

describe("medianFixCost", () => {
  it("is unknown when there is no fix or no known cost, never zero", () => {
    expect(medianFixCost([])).toEqual({ known: false });
    expect(medianFixCost([{ findingId: "a", costUsdCents: null }])).toEqual({ known: false });
  });

  it("takes the median of the known costs and counts the unknown ones apart", () => {
    expect(
      medianFixCost([
        { findingId: "a", costUsdCents: 300 },
        { findingId: "b", costUsdCents: 100 },
        { findingId: "c", costUsdCents: null },
        { findingId: "d", costUsdCents: 200 },
      ]),
    ).toEqual({ known: true, medianUsdCents: 200, verifiedCount: 3, unknownCount: 1 });
  });

  it("averages the two middle costs of an even count", () => {
    const m = medianFixCost([
      { findingId: "a", costUsdCents: 100 },
      { findingId: "b", costUsdCents: 201 },
    ]);
    expect(m).toMatchObject({ known: true, medianUsdCents: 151 });
  });

  it("keeps a real zero cost as zero", () => {
    expect(medianFixCost([{ findingId: "a", costUsdCents: 0 }])).toMatchObject({
      known: true,
      medianUsdCents: 0,
    });
  });
});

describe("formatUsd", () => {
  it("shows cents as dollars", () => {
    expect(formatUsd(12345)).toBe("$123.45");
  });
});
