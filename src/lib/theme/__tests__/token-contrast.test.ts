import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Token-contrast invariant — the keystone readability test for the single
 * dark brand (#650). It parses the canonical `:root` token block out of
 * `app/globals.css` and asserts that every semantic foreground/background
 * pairing meets WCAG 2.1 AA: >=4.5:1 for normal text, >=3:1 for large text
 * and non-text UI affordances (focus ring, input boundary).
 *
 * Readability is the product's #1 goal, so this is a hard gate, not a guide.
 * The contrast math mirrors `src/lib/graph/__tests__/theme-colors.test.ts`
 * (the graph canvas WCAG test), extended with an oklch -> linear-sRGB
 * conversion because the design tokens are authored in oklch.
 */

// ----------------------------------------------------------------------------
// oklch -> relative luminance (pure, no DOM)
// ----------------------------------------------------------------------------

/** Clamp to [0,1] to fold out-of-gamut colors back into displayable sRGB. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Convert an oklch triple (L in [0,1], C >= 0, H in degrees) to WCAG relative
 * luminance. Goes oklch -> OKLab -> linear sRGB; the linear RGB channels ARE
 * the linearized values WCAG luminance is defined over, so we weight them
 * directly (no need to re-apply the sRGB transfer function and invert it).
 */
function oklchLuminance(L: number, C: number, H: number): number {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bch = clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  return 0.2126 * r + 0.7152 * g + 0.0722 * bch;
}

function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ----------------------------------------------------------------------------
// Parse the canonical :root token block from app/globals.css
// ----------------------------------------------------------------------------

/** Extract the body of the first balanced `:root { ... }` block. */
function firstRootBlock(css: string): string {
  const start = css.indexOf(":root");
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("no balanced :root block found in globals.css");
}

function parseTokens(css: string): Map<string, string> {
  const body = firstRootBlock(css);
  const tokens = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    tokens.set(m[1].trim(), m[2].trim());
  }
  return tokens;
}

/** Resolve a token to its oklch luminance, following one level of var(). */
function luminanceOf(name: string, tokens: Map<string, string>): number {
  let value = tokens.get(name);
  if (!value) throw new Error(`token ${name} not found`);

  const varMatch = value.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    const inner = tokens.get(varMatch[1]);
    if (!inner) throw new Error(`token ${name} -> ${varMatch[1]} not found`);
    value = inner;
  }

  const ok = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!ok) throw new Error(`token ${name} is not an oklch color: "${value}"`);
  return oklchLuminance(parseFloat(ok[1]), parseFloat(ok[2]), parseFloat(ok[3]));
}

const css = readFileSync(
  resolve(process.cwd(), "app/globals.css"),
  "utf8",
);
const tokens = parseTokens(css);

// Normal-text foreground/background pairs — must clear AA 4.5:1.
const TEXT_PAIRS: ReadonlyArray<[fg: string, bg: string]> = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--destructive-foreground", "--destructive"],
  ["--warning-foreground", "--warning"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  // muted-foreground is dim secondary text rendered on several surfaces.
  ["--muted-foreground", "--muted"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
];

// Non-text UI affordances — must clear AA 3:1 against the base background.
const UI_PAIRS: ReadonlyArray<[token: string, bg: string]> = [
  ["--ring", "--background"],
  ["--input", "--background"],
];

describe("token-contrast (single dark brand)", () => {
  it("parses the canonical :root token block", () => {
    expect(tokens.get("--background")).toBeDefined();
    expect(tokens.get("--primary")).toBeDefined();
    expect(tokens.size).toBeGreaterThan(20);
  });

  describe("normal text meets WCAG AA (>=4.5:1)", () => {
    it.each(TEXT_PAIRS)("%s on %s", (fg, bg) => {
      const ratio = contrastRatio(
        luminanceOf(fg, tokens),
        luminanceOf(bg, tokens),
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("UI affordances meet WCAG AA (>=3:1)", () => {
    it.each(UI_PAIRS)("%s on %s", (token, bg) => {
      const ratio = contrastRatio(
        luminanceOf(token, tokens),
        luminanceOf(bg, tokens),
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });
});
