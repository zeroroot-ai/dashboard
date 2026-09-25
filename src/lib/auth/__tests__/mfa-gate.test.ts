// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for src/lib/auth/mfa-gate.ts (hosted#193 decision D3).
 */

import { describe, it, expect } from "vitest";
import { amrShowsMfa, evaluateMfaGate } from "../mfa-gate";

describe("amrShowsMfa", () => {
  it("is true for a password plus TOTP", () => {
    expect(amrShowsMfa(["pwd", "otp", "mfa"])).toBe(true);
  });

  it("is true for a passkey", () => {
    expect(amrShowsMfa(["user", "mfa"])).toBe(true);
  });

  it("is false for a password alone", () => {
    expect(amrShowsMfa(["pwd"])).toBe(false);
  });

  it("is false when amr is missing", () => {
    expect(amrShowsMfa(undefined)).toBe(false);
  });

  it("is false when amr is not an array", () => {
    expect(amrShowsMfa("mfa")).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(amrShowsMfa([])).toBe(false);
  });
});

describe("evaluateMfaGate", () => {
  it("accepts a zitadel sign-in with a password plus TOTP", () => {
    expect(evaluateMfaGate("zitadel", ["pwd", "otp", "mfa"])).toBe(true);
  });

  it("accepts a zitadel sign-in with a passkey", () => {
    expect(evaluateMfaGate("zitadel", ["user", "mfa"])).toBe(true);
  });

  it("refuses a zitadel sign-in with a password alone", () => {
    expect(evaluateMfaGate("zitadel", ["pwd"])).toBe(
      "/login/error?reason=mfa_required",
    );
  });

  it("refuses a zitadel sign-in with no amr claim", () => {
    expect(evaluateMfaGate("zitadel", undefined)).toBe(
      "/login/error?reason=mfa_required",
    );
  });

  it("does not gate a non-zitadel provider", () => {
    expect(evaluateMfaGate("credentials", undefined)).toBe(true);
    expect(evaluateMfaGate(undefined, undefined)).toBe(true);
  });
});
