// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import { PROVIDER_NAME_MAX_LENGTH, providerNameError } from "../provider-name";

describe("providerNameError", () => {
  it.each(["a", "0", "anthropic", "anthropic-prod", "a-b-c", "a1-2b", "x".repeat(63)])(
    "accepts %s",
    (name) => {
      expect(providerNameError(name)).toBeNull();
    },
  );

  it.each([
    ["", "Name is required"],
    ["x".repeat(64), `Use at most ${PROVIDER_NAME_MAX_LENGTH} characters`],
  ])("refuses %j with %s", (name, msg) => {
    expect(providerNameError(name)).toBe(msg);
  });

  it.each([
    "Anthropic",
    "anthropic_prod",
    "anthropic.prod",
    "-anthropic",
    "anthropic-",
    "anthropic prod",
    "anthropic/prod",
    "prod:1",
    "ünicode",
    "a\n",
  ])("refuses %j", (name) => {
    expect(providerNameError(name)).not.toBeNull();
  });
});
