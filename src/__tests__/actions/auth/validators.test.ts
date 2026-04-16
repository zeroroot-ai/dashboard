/**
 * Smoke tests for the shared auth validators.
 *
 * The signup form (client) and the signUpAction (server) both consume
 * these schemas — divergence here would silently let weak passwords
 * past either layer.
 */
import { describe, expect, it } from "vitest";
import { passwordSchema, signupSchema, signinSchema } from "@/src/lib/validators/auth";

describe("passwordSchema", () => {
  it("rejects short passwords", () => {
    expect(passwordSchema.safeParse("Aa1!aaaa").success).toBe(false);
  });
  it("rejects passwords missing complexity classes", () => {
    expect(passwordSchema.safeParse("alllowercase1!").success).toBe(false); // no upper
    expect(passwordSchema.safeParse("ALLUPPERCASE1!").success).toBe(false); // no lower
    expect(passwordSchema.safeParse("NoDigits!aaaaaa").success).toBe(false); // no digit
    expect(passwordSchema.safeParse("NoSpecial1aaaaaa").success).toBe(false); // no special
  });
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Strong1Pass!ok").success).toBe(true);
  });
});

describe("signupSchema", () => {
  const base = {
    companyName: "Acme",
    email: "user@example.com",
    password: "Strong1Pass!ok",
    confirmPassword: "Strong1Pass!ok",
    tosAccepted: true as const,
  };
  it("accepts a well-formed payload", () => {
    expect(signupSchema.safeParse(base).success).toBe(true);
  });
  it("rejects mismatched passwords", () => {
    expect(
      signupSchema.safeParse({ ...base, confirmPassword: "Different1!" }).success,
    ).toBe(false);
  });
  it("rejects an unaccepted ToS", () => {
    expect(
      signupSchema.safeParse({ ...base, tosAccepted: false as unknown as true }).success,
    ).toBe(false);
  });
  it("rejects a too-short company name", () => {
    expect(signupSchema.safeParse({ ...base, companyName: "a" }).success).toBe(false);
  });
});

describe("signinSchema", () => {
  it("requires both fields", () => {
    expect(signinSchema.safeParse({ email: "", password: "" }).success).toBe(false);
    expect(signinSchema.safeParse({ email: "u@e.com", password: "" }).success).toBe(false);
  });
  it("accepts a valid pair", () => {
    expect(
      signinSchema.safeParse({ email: "u@e.com", password: "x" }).success,
    ).toBe(true);
  });
});
