// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { FINDING_PARAM, findingGraphHref } from "../finding-link";

describe("findingGraphHref", () => {
  it("names the finding in the query of the graph page", () => {
    expect(findingGraphHref("abc-123")).toBe("/dashboard/graph?finding=abc-123");
  });

  it("encodes an id with a reserved character, and the page reads the same id back", () => {
    const href = findingGraphHref("a/b&c");
    expect(href).toBe("/dashboard/graph?finding=a%2Fb%26c");
    expect(new URL(href, "http://x").searchParams.get(FINDING_PARAM)).toBe("a/b&c");
  });
});
