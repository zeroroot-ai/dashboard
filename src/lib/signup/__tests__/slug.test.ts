import { describe, expect, it } from "vitest";
import { isReservedSlug, slugify } from "../slug";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("ACME")).toBe("acme");
  });
  it("replaces non [a-z0-9-] runs with single hyphen", () => {
    expect(slugify("My Company! 2025")).toBe("my-company-2025");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });
  it("caps at 63 characters", () => {
    const huge = "a".repeat(80);
    expect(slugify(huge)).toHaveLength(63);
  });
});

describe("isReservedSlug", () => {
  const denylist = {
    exact: ["default", "kube-system", "gibson"],
    prefix: ["kube-", "system-"],
  };

  it("returns false for empty", () => {
    expect(isReservedSlug("", denylist)).toBe(false);
  });
  it("matches exact entries", () => {
    expect(isReservedSlug("default", denylist)).toBe(true);
    expect(isReservedSlug("gibson", denylist)).toBe(true);
  });
  it("matches prefix entries", () => {
    expect(isReservedSlug("kube-foo", denylist)).toBe(true);
    expect(isReservedSlug("system-bar", denylist)).toBe(true);
  });
  it("does not match non-reserved", () => {
    expect(isReservedSlug("acme", denylist)).toBe(false);
    expect(isReservedSlug("kubernetic", denylist)).toBe(false);
  });
  it("ignores empty prefix entries (defensive)", () => {
    const dl = { exact: [], prefix: ["", "kube-"] };
    expect(isReservedSlug("anything", dl)).toBe(false);
    expect(isReservedSlug("kube-x", dl)).toBe(true);
  });
});
