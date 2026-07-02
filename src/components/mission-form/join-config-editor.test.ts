import { describe, it, expect } from "vitest";

import { validateJoinConfig } from "./join-config-editor";
import { MergeStrategy } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

const baseConfig = (overrides: Partial<{
  waitFor: string[];
  strategy: MergeStrategy;
  aggregator: string;
}> = {}) => ({
  $typeName: "gibson.mission.v1.JoinNodeConfig" as const,
  waitFor: overrides.waitFor ?? [],
  strategy: overrides.strategy ?? MergeStrategy.CONCAT,
  aggregator: overrides.aggregator ?? "",
});

describe("validateJoinConfig", () => {
  it("rejects empty wait_for", () => {
    const errs = validateJoinConfig(baseConfig());
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldPath).toBe("wait_for");
    expect(errs[0].severity).toBe("error");
  });

  it("rejects undefined config", () => {
    const errs = validateJoinConfig(undefined);
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldPath).toBe("wait_for");
  });

  it("requires aggregator when strategy is CUSTOM", () => {
    const errs = validateJoinConfig(
      baseConfig({
        waitFor: ["a"],
        strategy: MergeStrategy.CUSTOM,
        aggregator: "",
      }),
    );
    expect(errs.find((e) => e.fieldPath === "aggregator")).toBeDefined();
  });

  it("accepts CUSTOM with non-empty aggregator", () => {
    const errs = validateJoinConfig(
      baseConfig({
        waitFor: ["a"],
        strategy: MergeStrategy.CUSTOM,
        aggregator: "sources.a.count > 0",
      }),
    );
    expect(errs).toHaveLength(0);
  });

  it("accepts CONCAT with non-empty wait_for", () => {
    const errs = validateJoinConfig(
      baseConfig({
        waitFor: ["a", "b"],
        strategy: MergeStrategy.CONCAT,
      }),
    );
    expect(errs).toHaveLength(0);
  });

  it("does not require aggregator for non-CUSTOM strategies", () => {
    for (const s of [
      MergeStrategy.CONCAT,
      MergeStrategy.REDUCE,
      MergeStrategy.FIRST,
      MergeStrategy.LAST,
    ]) {
      const errs = validateJoinConfig(
        baseConfig({ waitFor: ["a"], strategy: s, aggregator: "" }),
      );
      expect(errs.find((e) => e.fieldPath === "aggregator")).toBeUndefined();
    }
  });
});
