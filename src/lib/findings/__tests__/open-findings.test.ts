// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { OpenFindingViewSchema } from "@/src/gen/gibson/world/v1/world_pb";
import { safeHttpUrl, toOpenFinding } from "../open-findings";

describe("toOpenFinding", () => {
  it("maps the fields and keeps priority and status unknown when the daemon sends none", () => {
    const f = toOpenFinding(create(OpenFindingViewSchema, { id: "f1", title: "T", severity: "HIGH" }));
    expect(f).toMatchObject({ id: "f1", severity: "high", status: undefined, priority: undefined });
  });

  it("reads confidence 0 as unknown and a positive value as known", () => {
    expect(toOpenFinding(create(OpenFindingViewSchema, { confidence: 0 })).confidence).toBeUndefined();
    expect(toOpenFinding(create(OpenFindingViewSchema, { confidence: 0.4 })).confidence).toBe(0.4);
  });

  it("keeps the places and the status, and drops a merge request URL that is not http", () => {
    const f = toOpenFinding(
      create(OpenFindingViewSchema, {
        status: "fixing",
        priority: "P2",
        priorityRule: "rule",
        mergeRequestUrl: "javascript:alert(1)",
        places: [{ label: "app", key: "k" }],
      }),
    );
    expect(f.status).toBe("fixing");
    expect(f.priority).toBe("P2");
    expect(f.places).toEqual([{ label: "app", key: "k" }]);
    expect(f.mergeRequestUrl).toBe("");
  });
});

describe("safeHttpUrl", () => {
  it("allows http and https only", () => {
    expect(safeHttpUrl("https://git.example/mr/1")).toBe("https://git.example/mr/1");
    expect(safeHttpUrl("gitlab:group/repo!4")).toBe("");
  });
});
