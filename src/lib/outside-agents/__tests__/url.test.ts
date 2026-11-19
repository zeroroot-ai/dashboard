// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import { outsideAgentUrlError } from "../url";

describe("outsideAgentUrlError", () => {
  it.each(["https://agent.example.com/a2a", " https://agent.example.com:8443/x?y=1 "])(
    "accepts %s",
    (u) => expect(outsideAgentUrlError(u)).toBeNull(),
  );
  it.each([
    ["", /required/],
    ["   ", /required/],
    ["http://agent.example.com", /HTTPS/],
    ["ftp://agent.example.com", /HTTPS/],
    ["agent.example.com", /not a valid URL/],
    ["https://", /not a valid URL/],
    ["https://a.example/" + "x".repeat(2050), /at most 2048/],
  ])("refuses %s", (u, re) => expect(outsideAgentUrlError(u)).toMatch(re));
});
