// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ListActionsByGrantResponseSchema } from "@/src/gen/gibson/world/v1/world_pb";
import { grantLabel, toActionsByGrant } from "../actions-by-grant";

describe("toActionsByGrant", () => {
  it("maps a group and its times, and leaves a missing time empty", () => {
    const r = toActionsByGrant(
      create(ListActionsByGrantResponseSchema, {
        truncated: true,
        groups: [
          {
            grantObject: "connector:git",
            grantRelation: "can_use",
            grantor: "u1",
            count: 2,
            first: { seconds: BigInt(1_700_000_000), nanos: 0 },
            agents: ["a"],
            tools: ["t"],
          },
        ],
      }),
    );
    expect(r.truncated).toBe(true);
    expect(r.groups[0]).toMatchObject({ count: 2, grantor: "u1", agents: ["a"], last: "" });
    expect(r.groups[0].first).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("grantLabel", () => {
  it("joins the object and the relation, and is empty with neither", () => {
    expect(grantLabel({ grantObject: "o", grantRelation: "r" })).toBe("o#r");
    expect(grantLabel({ grantObject: "", grantRelation: "" })).toBe("");
  });
});
