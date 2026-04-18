/**
 * Unit tests for countSignInMethods.
 *
 * Verifies the counting logic for all combinations of credential types:
 *  - password-only (credential)
 *  - 1 social only
 *  - password + 1 social = 2
 *  - password + 2 socials = 3
 *  - 2 socials (no password) = 2
 *  - empty array = 0
 *  - duplicate provider IDs are de-duplicated
 */

import { describe, expect, it } from "vitest";
import { countSignInMethods } from "../count-signin-methods";

describe("countSignInMethods", () => {
  it("returns 0 for an empty account list", () => {
    expect(countSignInMethods([])).toBe(0);
  });

  it("returns 1 for password-only (credential account)", () => {
    expect(countSignInMethods([{ providerId: "credential" }])).toBe(1);
  });

  it("returns 1 for a single social provider", () => {
    expect(countSignInMethods([{ providerId: "github" }])).toBe(1);
  });

  it("returns 2 for password + 1 social provider", () => {
    expect(
      countSignInMethods([{ providerId: "credential" }, { providerId: "github" }])
    ).toBe(2);
  });

  it("returns 3 for password + 2 social providers", () => {
    expect(
      countSignInMethods([
        { providerId: "credential" },
        { providerId: "github" },
        { providerId: "google" },
      ])
    ).toBe(3);
  });

  it("returns 2 for 2 social providers with no password", () => {
    expect(
      countSignInMethods([{ providerId: "github" }, { providerId: "gitlab" }])
    ).toBe(2);
  });

  it("de-duplicates the same provider ID appearing twice", () => {
    // Better Auth should never create duplicates, but the helper must handle it.
    expect(
      countSignInMethods([{ providerId: "github" }, { providerId: "github" }])
    ).toBe(1);
  });

  it("returns 4 for all four social providers + password", () => {
    expect(
      countSignInMethods([
        { providerId: "credential" },
        { providerId: "github" },
        { providerId: "gitlab" },
        { providerId: "google" },
        { providerId: "microsoft" },
      ])
    ).toBe(5); // credential + 4 socials
  });
});
