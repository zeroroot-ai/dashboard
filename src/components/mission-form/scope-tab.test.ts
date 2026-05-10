import { describe, it, expect } from "vitest";

import { emptyDefinition } from "@/src/types/mission-state";
import type { MissionDefinition } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

describe("ScopeTab data binding", () => {
  it("emptyDefinition has the expected shape", () => {
    const def: MissionDefinition = emptyDefinition;
    expect(def.$typeName).toBe("gibson.mission.v1.MissionDefinition");
    expect(def.name).toBe("");
    expect(def.version).toBe("1.0.0");
    expect(def.nodes).toEqual({});
    expect(def.edges).toEqual([]);
  });

  it("supports field-level updates via spread", () => {
    const before: MissionDefinition = emptyDefinition;
    const after: MissionDefinition = {
      ...before,
      name: "test-mission",
      description: "scope test",
      targetRef: "tgt-1",
    };
    expect(after.name).toBe("test-mission");
    expect(after.description).toBe("scope test");
    expect(after.targetRef).toBe("tgt-1");
    // Original unmodified
    expect(before.name).toBe("");
  });
});
