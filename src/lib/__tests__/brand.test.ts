import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_NAME_SHORT } from "../brand";

describe("brand", () => {
  it("is the Zero Root AI product name (deploy rebrand)", () => {
    expect(PRODUCT_NAME).toBe("Zero Root AI");
    expect(PRODUCT_NAME_SHORT).toBe("Zero Root");
  });

  it("carries no trace of the pre-rebrand name", () => {
    expect(PRODUCT_NAME).not.toMatch(/Zero Day/);
    expect(PRODUCT_NAME_SHORT).not.toMatch(/Zero Day/);
  });
});
