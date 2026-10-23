// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for src/lib/auth/session-subject.ts.
 */

import { describe, it, expect } from "vitest";
import { sessionSubject } from "../session-subject";

const ID = "395121752285380837";

describe("sessionSubject", () => {
  it("is the Zitadel user id when the profile and the account name it", () => {
    expect(sessionSubject({ providerAccountId: ID }, { sub: ID })).toBe(ID);
  });

  it("is null when the profile names no sub, even if the account names an id", () => {
    // Auth.js fills providerAccountId with a random UUID when the profile has no id.
    expect(sessionSubject({ providerAccountId: "7f9c2b1e-0000-4000-8000-000000000000" }, {})).toBeNull();
    expect(sessionSubject({ providerAccountId: ID }, { sub: "" })).toBeNull();
    expect(sessionSubject({ providerAccountId: ID }, undefined)).toBeNull();
  });

  it("is null when the account names a different id", () => {
    expect(sessionSubject({ providerAccountId: "other" }, { sub: ID })).toBeNull();
    expect(sessionSubject({}, { sub: ID })).toBeNull();
    expect(sessionSubject(null, { sub: ID })).toBeNull();
  });
});
