// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import { formatPublishedAt, shortDigest } from "../view";

const HEX = "0123456789abcdef".repeat(4);

describe("shortDigest", () => {
  it("keeps the prefix and the first 12 hex characters", () => {
    expect(shortDigest(`sha256:${HEX}`)).toBe("sha256:0123456789ab");
  });
  it("returns other text as it is", () => {
    expect(shortDigest("")).toBe("");
    expect(shortDigest("sha256:abc")).toBe("sha256:abc");
  });
});

describe("formatPublishedAt", () => {
  it("returns an empty text for an empty time and the raw text for a bad time", () => {
    expect(formatPublishedAt("")).toBe("");
    expect(formatPublishedAt("not a time")).toBe("not a time");
  });
  it("formats a valid time", () => {
    expect(formatPublishedAt("2026-11-18T10:00:00.000Z")).not.toBe("");
  });
});
