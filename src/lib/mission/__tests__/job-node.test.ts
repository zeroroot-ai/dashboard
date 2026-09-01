import { describe, it, expect } from "vitest";
import {
  EMPTY_JOB_NODE,
  JOB_IMPORT_LINE,
  insertNodeIntoCue,
  jobNodeSchema,
  jobNodeToCue,
  jobNodeValuesFromJson,
  type JobNodeFormValues,
} from "../job-node";
import { NEW_MISSION_CUE } from "@/src/data/new-mission-template";

const full: JobNodeFormValues = {
  nodeId: "fix",
  name: "Fix what the scanner found",
  bankRef: "fix-crew",
  goal: "Fix the findings and add a regression test.",
  repositories: [
    { name: "app", connectorRef: "connector/gitlab", project: "acme/app", baseBranch: "main", deliverable: "merge_request" },
  ],
  credentialNames: ["npm-token"],
  inputs: ["scan"],
  verifierComponent: "agent/verifier",
  passingScore: 0.8,
  maxPasses: 3,
  maxTurns: 40,
  maxTokens: 0,
  deadlineMinutes: 90,
};

describe("jobNodeSchema mirrors the daemon's OpenJob checks", () => {
  it("accepts a full node", () => {
    expect(jobNodeSchema.safeParse(full).success).toBe(true);
  });
  it("needs a bank and a goal", () => {
    expect(jobNodeSchema.safeParse({ ...full, bankRef: "" }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, goal: " " }).success).toBe(false);
  });
  it("needs the slash form for connector and verifier refs", () => {
    expect(jobNodeSchema.safeParse({ ...full, repositories: [{ ...full.repositories[0], connectorRef: "gitlab" }] }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, repositories: [{ ...full.repositories[0], connectorRef: "connector-gitlab" }] }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, verifierComponent: "verifier" }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, verifierComponent: "tool/semgrep" }).success).toBe(true);
    expect(jobNodeSchema.safeParse({ ...full, verifierComponent: "" }).success).toBe(false); // maxPasses 3 needs a verifier
    expect(jobNodeSchema.safeParse({ ...full, verifierComponent: "", maxPasses: 1 }).success).toBe(true);
  });
  it("keeps the score in 0..1 and the counts at zero or more", () => {
    expect(jobNodeSchema.safeParse({ ...full, passingScore: 1.2 }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, maxPasses: -1 }).success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, maxTurns: "12" }).success).toBe(true);
  });
  it("refuses two worktrees with one name and a bad node id", () => {
    const r = jobNodeSchema.safeParse({ ...full, repositories: [full.repositories[0], full.repositories[0]] });
    expect(r.success).toBe(false);
    expect(jobNodeSchema.safeParse({ ...full, nodeId: "Fix it" }).success).toBe(false);
  });
});

describe("jobNodeToCue", () => {
  it("emits a NODE_TYPE_JOB node with jobConfig, acceptance, constraints and the deadline as the node timeout", () => {
    const cue = jobNodeToCue(full);
    expect(cue).toContain("\t\tfix: {");
    expect(cue).toContain('id:   "fix"');
    expect(cue).toContain("type: missionv1.#NODE_TYPE_JOB");
    expect(cue).toContain('timeout: "5400s"');
    expect(cue).toContain('bankRef: "fix-crew"');
    expect(cue).toContain('goal: "Fix the findings and add a regression test."');
    expect(cue).toContain('connectorRef: "connector/gitlab"');
    expect(cue).toContain("deliverable:  jobv1.#DELIVERABLE_KIND_MERGE_REQUEST");
    expect(cue).toContain('credentialNames: ["npm-token"]');
    expect(cue).toContain('inputs: ["scan"]');
    expect(cue).toContain('verifierComponent: "agent/verifier"');
    expect(cue).toContain("passingScore:      0.8");
    expect(cue).toContain("maxPasses:         3");
    expect(cue).toContain("maxTurns:  40");
    expect(cue).not.toContain("maxTokens");
  });
  it("omits what the form left at its default", () => {
    const cue = jobNodeToCue({ ...EMPTY_JOB_NODE, bankRef: "b", goal: "g" });
    expect(cue).not.toContain("timeout");
    expect(cue).not.toContain("repositories");
    expect(cue).not.toContain("acceptance");
    expect(cue).not.toContain("constraints");
  });
});

describe("insertNodeIntoCue", () => {
  it("inserts the node first in the nodes block of the new-mission template and adds the job import", () => {
    const out = insertNodeIntoCue(NEW_MISSION_CUE, "fix", jobNodeToCue(full));
    expect(out).toContain(JOB_IMPORT_LINE);
    expect(out.indexOf(JOB_IMPORT_LINE)).toBeGreaterThan(out.indexOf("import missionv1"));
    expect(out.indexOf("\t\tfix: {")).toBeLessThan(out.indexOf("\t\tassess: {"));
    expect(out.indexOf("\t\tfix: {")).toBeGreaterThan(out.indexOf("\tnodes: {"));
  });
  it("is a no-op when the node id is already present", () => {
    const once = insertNodeIntoCue(NEW_MISSION_CUE, "fix", jobNodeToCue(full));
    expect(insertNodeIntoCue(once, "fix", jobNodeToCue(full))).toBe(once);
  });
  it("adds a nodes block when the source has none", () => {
    const src = 'import missionv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/mission/v1"\n\nmission: missionv1.#MissionDefinition & {\n\tname: "x"\n\tentryPoints: []\n}\n';
    const out = insertNodeIntoCue(src, "fix", jobNodeToCue({ ...EMPTY_JOB_NODE, bankRef: "b", goal: "g" }));
    expect(out).toContain("\tnodes: {\n\t\tfix: {");
    expect(out.indexOf("\tnodes: {")).toBeLessThan(out.indexOf("\tentryPoints"));
    expect(out).not.toContain(JOB_IMPORT_LINE); // no jobv1 symbol in a node without a deliverable
  });
});

describe("round trip: the stored definition feeds the form with the same values", () => {
  it("reads the protobuf JSON the definition route returns", () => {
    const json = {
      name: full.name,
      timeout: "5400s",
      jobConfig: {
        bankRef: "fix-crew",
        spec: {
          goal: full.goal,
          repositories: [{ name: "app", connectorRef: "connector/gitlab", project: "acme/app", baseBranch: "main", deliverable: "DELIVERABLE_KIND_MERGE_REQUEST" }],
          credentialNames: ["npm-token"],
          inputs: ["scan"],
          acceptance: { verifierComponent: "agent/verifier", passingScore: 0.8, maxPasses: 3 },
        },
        constraints: { maxTurns: 40 },
      },
    };
    expect(jobNodeValuesFromJson("fix", json)).toEqual(full);
  });
  it("reads a node with defaults back to the form defaults", () => {
    const v = jobNodeValuesFromJson("fix", { jobConfig: { bankRef: "b", spec: { goal: "g" } } });
    expect(v).toEqual({ ...EMPTY_JOB_NODE, bankRef: "b", goal: "g" });
    expect(jobNodeToCue(v)).toBe(jobNodeToCue({ ...EMPTY_JOB_NODE, bankRef: "b", goal: "g" }));
  });
});
