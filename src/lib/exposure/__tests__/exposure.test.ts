// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { GetExposureTrendResponseSchema } from "@/src/gen/gibson/world/v1/world_pb";
import { formatRate, formatSeconds, medianChange, revertChange, toExposureTrend } from "../exposure";

describe("exposure", () => {
  it("maps int64 seconds to numbers", () => {
    const t = toExposureTrend(
      create(GetExposureTrendResponseSchema, { count: 2, medianSeconds: BigInt(90), previousCount: 1 }),
    );
    expect(t).toMatchObject({ count: 2, medianSeconds: 90, previousCount: 1 });
  });

  it("gives no change when a period has no data", () => {
    const base = { periodSeconds: 1, medianAgentSeconds: 0, medianWaitSeconds: 0 };
    expect(medianChange({ ...base, count: 0, medianSeconds: 0, previousCount: 2, previousMedianSeconds: 5 })).toBeNull();
    expect(medianChange({ ...base, count: 2, medianSeconds: 5, previousCount: 0, previousMedianSeconds: 0 })).toBeNull();
    expect(medianChange({ ...base, count: 2, medianSeconds: 9, previousCount: 2, previousMedianSeconds: 5 })).toEqual({
      seconds: 4,
      direction: "up",
    });
  });

  it("gives no revert change when a period merged nothing", () => {
    const p = (merged: number, rate: number) => ({ merged, reverted: 0, rate });
    expect(revertChange({ periodSeconds: 1, current: p(0, 0), previous: p(3, 0.5) })).toBeNull();
    expect(revertChange({ periodSeconds: 1, current: p(4, 0.5), previous: p(3, 0.25) })).toEqual({
      points: 25,
      direction: "up",
    });
  });

  it("formats durations and rates", () => {
    expect(formatSeconds(30)).toBe("less than 1 minute");
    expect(formatSeconds(90_000)).toBe("1 d 1 h");
    expect(formatRate(0.126)).toBe("13%");
  });
});
