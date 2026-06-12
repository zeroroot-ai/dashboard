import { describe, it, expect } from "vitest";
import {
  resolveUserFacingError,
  type UserFacingError,
  type UserFacingErrorCode,
} from "../user-facing";

// ---------------------------------------------------------------------------
// Exhaustiveness helpers
// ---------------------------------------------------------------------------

/**
 * The complete set of codes defined by the union, listed explicitly so that
 * adding a new member to `UserFacingErrorCode` without updating this array
 * causes the `satisfies` constraint below to produce a compile-time error.
 *
 * This mirrors the exhaustiveness guarantee on the implementation's
 * `ERROR_TABLE satisfies Record<UserFacingErrorCode, ...>`.
 */
const ALL_CODES = [
  "COMPANY_NAME_TAKEN",
  "EMAIL_ALREADY_REGISTERED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
  "PASSWORD_POLICY",
  "PASSWORD_BREACHED",
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "CAPTCHA_REQUIRED",
  "CAPTCHA_FAILED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "SESSION_EXPIRED",
  "TENANT_FORBIDDEN",
  "SLUG_OWNED_BY_OTHER_USER",
] as const satisfies readonly UserFacingErrorCode[];

// Statically assert that ALL_CODES covers the full union, if the union gains
// a new member, the `satisfies` above will fail to compile.
type _AssertAllCodesExhaustive = [UserFacingErrorCode] extends [
  (typeof ALL_CODES)[number]
]
  ? true
  : never;
const _exhaustiveCheck: _AssertAllCodesExhaustive = true;
void _exhaustiveCheck; // prevent unused-variable lint

// ---------------------------------------------------------------------------
// Core exhaustiveness test
// ---------------------------------------------------------------------------

describe("resolveUserFacingError, exhaustiveness", () => {
  it.each(ALL_CODES)(
    "code %s resolves to non-empty title and description",
    (code) => {
      const result: UserFacingError = resolveUserFacingError(code);

      expect(result.code).toBe(code);
      expect(typeof result.title).toBe("string");
      expect(result.title.trim().length).toBeGreaterThan(0);
      expect(typeof result.description).toBe("string");
      expect(result.description.trim().length).toBeGreaterThan(0);
    }
  );

  it("covers exactly the expected number of codes", () => {
    // Fail fast if codes are silently added/removed without updating the test.
    expect(ALL_CODES).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// correlationId plumbing
// ---------------------------------------------------------------------------

describe("resolveUserFacingError, correlationId", () => {
  it("omits correlationId when not provided", () => {
    const result = resolveUserFacingError("RATE_LIMITED");
    expect(result.correlationId).toBeUndefined();
  });

  it("attaches correlationId when provided", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const result = resolveUserFacingError("SERVICE_UNAVAILABLE", id);
    expect(result.correlationId).toBe(id);
  });

  it("does not mutate a second call without correlationId", () => {
    const id = "test-correlation-id";
    resolveUserFacingError("RATE_LIMITED", id);
    const second = resolveUserFacingError("RATE_LIMITED");
    expect(second.correlationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// action field
// ---------------------------------------------------------------------------

describe("resolveUserFacingError, action", () => {
  const codesWithAction: UserFacingErrorCode[] = [
    "EMAIL_ALREADY_REGISTERED",
    "INVALID_CREDENTIALS",
    "ACCOUNT_LOCKED",
    "EMAIL_NOT_VERIFIED",
    "TOKEN_EXPIRED",
    "TOKEN_INVALID",
    "SESSION_EXPIRED",
  ];

  const codesWithoutAction: UserFacingErrorCode[] = [
    "COMPANY_NAME_TAKEN",
    "PASSWORD_POLICY",
    "PASSWORD_BREACHED",
    "CAPTCHA_REQUIRED",
    "CAPTCHA_FAILED",
    "RATE_LIMITED",
    "SERVICE_UNAVAILABLE",
    "TENANT_FORBIDDEN",
    "SLUG_OWNED_BY_OTHER_USER",
  ];

  it.each(codesWithAction)("code %s includes an action", (code) => {
    const result = resolveUserFacingError(code);
    expect(result.action).toBeDefined();
    expect(typeof result.action!.label).toBe("string");
    expect(result.action!.label.trim().length).toBeGreaterThan(0);
    expect(typeof result.action!.href).toBe("string");
    expect(result.action!.href.startsWith("/")).toBe(true);
  });

  it.each(codesWithoutAction)("code %s has no action", (code) => {
    const result = resolveUserFacingError(code);
    expect(result.action).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Return shape integrity
// ---------------------------------------------------------------------------

describe("resolveUserFacingError, return shape", () => {
  it("always returns an object with the expected keys", () => {
    const result = resolveUserFacingError("INVALID_CREDENTIALS");
    // Required keys
    expect(result).toHaveProperty("code");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("description");
  });

  it("does not leak implementation detail keys", () => {
    const result = resolveUserFacingError("RATE_LIMITED") as unknown as Record<
      string,
      unknown
    >;
    const allowedKeys = new Set([
      "code",
      "title",
      "description",
      "action",
      "correlationId",
    ]);
    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it("each call returns a new object (no shared reference)", () => {
    const a = resolveUserFacingError("RATE_LIMITED");
    const b = resolveUserFacingError("RATE_LIMITED");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Spot-check specific copy expectations
// ---------------------------------------------------------------------------

describe("resolveUserFacingError, copy spot checks", () => {
  it("ACCOUNT_LOCKED title mentions locking", () => {
    const { title } = resolveUserFacingError("ACCOUNT_LOCKED");
    expect(title.toLowerCase()).toMatch(/lock/);
  });

  it("PASSWORD_BREACHED description mentions breach", () => {
    const { description } = resolveUserFacingError("PASSWORD_BREACHED");
    expect(description.toLowerCase()).toMatch(/breach/);
  });

  it("SESSION_EXPIRED action href points to /login", () => {
    const { action } = resolveUserFacingError("SESSION_EXPIRED");
    expect(action?.href).toBe("/login");
  });

  it("TOKEN_EXPIRED action href points to /forgot-password", () => {
    const { action } = resolveUserFacingError("TOKEN_EXPIRED");
    expect(action?.href).toBe("/forgot-password");
  });
});
