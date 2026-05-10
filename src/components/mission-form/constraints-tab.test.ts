import { describe, it, expect } from "vitest";

import { emptyConstraints } from "@/src/types/mission-state";

describe("ConstraintsTab data binding", () => {
  it("emptyConstraints has all proto fields zeroed", () => {
    const c = emptyConstraints;
    expect(c.$typeName).toBe("gibson.daemon.v1.MissionConstraints");
    expect(c.maxDurationSeconds).toBe(0);
    expect(c.maxFindings).toBe(0);
    expect(c.maxTokens).toBe(0);
    expect(c.maxTokensPerCall).toBe(0);
    expect(c.maxTurnsPerAgent).toBe(0);
    expect(c.allowedTechniques).toEqual([]);
    expect(c.blockedTechniques).toEqual([]);
  });

  it("supports max_tokens_per_call updates without losing other fields", () => {
    const c = { ...emptyConstraints, maxTokensPerCall: 1024 };
    expect(c.maxTokensPerCall).toBe(1024);
    expect(c.maxTokens).toBe(0);
  });

  it("technique list parsing accepts comma- or newline-separated input", () => {
    const parse = (raw: string) =>
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    expect(parse("T1078, T1190")).toEqual(["T1078", "T1190"]);
    expect(parse("T1078\nT1190")).toEqual(["T1078", "T1190"]);
    expect(parse(" T1078 , T1190 ")).toEqual(["T1078", "T1190"]);
    expect(parse("")).toEqual([]);
    expect(parse("\n,\n,")).toEqual([]);
  });
});
