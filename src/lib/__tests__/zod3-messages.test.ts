import { describe, expect, it } from "vitest";
import { createBankSchema, updateBankSchema } from "@/src/lib/banks/schema";
import { EMPTY_JOB_NODE, jobNodeSchema } from "@/src/lib/mission/job-node";
import { invalidEnumValue } from "@/src/lib/zod3-messages";

/** The messages of the zod 3 locale. A form user sees these, so they stay fixed. */
function messageAt(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, path: string): string[] {
  return (result.error?.issues ?? []).filter((i) => i.path.join(".") === path).map((i) => i.message);
}

const BANK = {
  name: "bank",
  tenantOwned: false,
  desiredCount: 1,
  loginShape: "api_key",
  providerConfigName: "cfg",
  agentName: "",
  model: "",
  maxJobsInFlight: 1,
  staleLimitMinutes: 0,
  spillPolicy: "queue",
};

describe("zod 3 default texts on the bank form", () => {
  it.each([
    ["name", { name: "x".repeat(121) }, "String must contain at most 120 character(s)"],
    ["agentName", { agentName: "x".repeat(121) }, "String must contain at most 120 character(s)"],
    ["model", { model: "x".repeat(201) }, "String must contain at most 200 character(s)"],
    ["desiredCount", { desiredCount: 1.5 }, "Expected integer, received float"],
    ["maxJobsInFlight", { maxJobsInFlight: "abc" }, "Expected number, received nan"],
    ["staleLimitMinutes", { staleLimitMinutes: "abc" }, "Expected number, received nan"],
  ])("%s", (field, patch, want) => {
    const result = createBankSchema.safeParse({ ...BANK, ...patch });
    expect(messageAt(result, field)).toEqual([want]);
  });

  it("the update schema counts use the same texts", () => {
    expect(messageAt(updateBankSchema.safeParse({ desiredCount: 1.5 }), "desiredCount")).toEqual(["Expected integer, received float"]);
    expect(messageAt(updateBankSchema.safeParse({ desiredCount: "abc" }), "desiredCount")).toEqual(["Expected number, received nan"]);
  });
});

describe("zod 3 default texts on the job node form", () => {
  const NODE = { ...EMPTY_JOB_NODE, bankRef: "bank/a", goal: "g" };

  it.each([
    ["name", { name: "x".repeat(121) }, "String must contain at most 120 character(s)"],
    ["credentialNames.0", { credentialNames: [""] }, "String must contain at least 1 character(s)"],
    ["inputs.0", { inputs: [" "] }, "String must contain at least 1 character(s)"],
    ["passingScore", { passingScore: "abc" }, "Expected number, received nan"],
    ["maxPasses", { maxPasses: 1.5 }, "Expected integer, received float"],
    ["maxTurns", { maxTurns: "abc" }, "Expected number, received nan"],
    ["maxTokens", { maxTokens: 2.5 }, "Expected integer, received float"],
    ["deadlineMinutes", { deadlineMinutes: "abc" }, "Expected number, received nan"],
  ])("%s", (field, patch, want) => {
    const result = jobNodeSchema.safeParse({ ...NODE, ...patch });
    expect(messageAt(result, field)).toEqual([want]);
  });
});

describe("invalidEnumValue", () => {
  it("builds the zod 3 enum text", () => {
    expect(invalidEnumValue(["admin", "writer"], "x")).toBe("Invalid enum value. Expected 'admin' | 'writer', received 'x'");
  });

  it("builds the zod 3 type text for a value that is not a string", () => {
    expect(invalidEnumValue(["admin", "writer"], null)).toBe("Expected 'admin' | 'writer', received null");
    expect(invalidEnumValue(["admin"], 3)).toBe("Expected 'admin', received number");
  });
});
