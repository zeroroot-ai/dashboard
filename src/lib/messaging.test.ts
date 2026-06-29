import { describe, it, expect } from "vitest";
import {
  COMPANY,
  ENGINE,
  umbrella,
  pillars,
  personas,
  headlines,
  hero,
  lockup,
} from "./messaging";

/**
 * Shape contract for the canonical messaging module. We assert structure and
 * the brand invariants every consuming surface depends on, NOT the exact prose
 * (copy is reviewed, not unit-tested). The banned-phrase voice rules are
 * enforced separately by scripts/check-no-banned-marketing-phrases.mjs.
 */
describe("messaging deck", () => {
  it("names the company and engine as fixed proper nouns", () => {
    expect(COMPANY).toBe("zeroroot.ai");
    expect(ENGINE).toBe("Gibson");
  });

  it("carries the umbrella tagline and supporting line", () => {
    expect(umbrella.tagline).toMatch(/zero-trust agent factory/i);
    expect(umbrella.supporting.length).toBeGreaterThan(0);
  });

  it("exposes exactly the three flagship pillars, each with title and body", () => {
    expect(pillars).toHaveLength(3);
    for (const p of pillars) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
    }
    // The signature pillar must be present.
    expect(pillars.some((p) => /thinks in paths/i.test(p.title))).toBe(true);
  });

  it("covers all four sides of the line in the persona set", () => {
    expect(personas.length).toBeGreaterThan(0);
    const sides = new Set(personas.map((p) => p.side));
    for (const side of ["offense", "defense", "purple", "platform"] as const) {
      expect(sides.has(side)).toBe(true);
    }
  });

  it("provides outcome-first headline candidates led by the signature line", () => {
    expect(headlines.length).toBeGreaterThan(0);
    expect(headlines[0]).toMatch(/thinks in paths/i);
  });

  it("supplies the hero block with a Gibson-highlighted headline", () => {
    expect(hero.headlineHighlight).toBe(ENGINE);
    expect(hero.headlineRest.length).toBeGreaterThan(0);
    expect(hero.subhead).toMatch(/Gibson/);
    expect(hero.eyebrow).toMatch(/zero-trust agent factory/i);
  });

  it("provides a closing lockup signed by the company", () => {
    expect(lockup.signature).toMatch(/zeroroot\.ai/);
    expect(lockup.line.length).toBeGreaterThan(0);
  });

  it("keeps no em-dashes in any rendered string (matches the repo-wide ban)", () => {
    const rendered = [
      umbrella.tagline,
      umbrella.supporting,
      ...pillars.flatMap((p) => [p.title, p.body]),
      ...headlines,
      hero.eyebrow,
      hero.headlineRest,
      hero.subhead,
      lockup.line,
      lockup.signature,
    ];
    for (const s of rendered) {
      expect(s).not.toContain("—");
    }
  });
});
