// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for src/lib/auth/session-subject.ts.
 */

import { describe, it, expect } from "vitest";
import { sessionSubjectFromAccount } from "../session-subject";

describe("sessionSubjectFromAccount", () => {
  it("is the Zitadel user id that Auth.js keeps as providerAccountId", () => {
    expect(sessionSubjectFromAccount({ providerAccountId: "395121752285380837" })).toBe("395121752285380837");
  });

  it("is null when the account is missing", () => {
    expect(sessionSubjectFromAccount(undefined)).toBeNull();
    expect(sessionSubjectFromAccount(null)).toBeNull();
  });

  it("is null when the account names no provider id", () => {
    expect(sessionSubjectFromAccount({})).toBeNull();
    expect(sessionSubjectFromAccount({ providerAccountId: "" })).toBeNull();
    expect(sessionSubjectFromAccount({ providerAccountId: 395121752285380837 })).toBeNull();
  });
});
