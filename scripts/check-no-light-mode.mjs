#!/usr/bin/env node
/*
 * check-no-light-mode.mjs
 *
 * Enforces the single locked dark brand (#651, PRD #649). Fails the build
 * if any reintroduced light-mode construct appears in the source tree:
 *
 *   1. An import from `next-themes` (the library is removed entirely).
 *   2. The `theme_choice` cookie/metadata key (per-user/-device theme state).
 *   3. In CSS: a `.dark` class selector, a `prefers-color-scheme` media
 *      query, or a class/media-based `@custom-variant dark` definition.
 *   4. A `'light'`/`"light"` THEME string literal — i.e. one appearing on a
 *      line that also mentions `dark`, `theme`, or `mode`. This catches
 *      reintroduced theme machinery (`'dark' | 'light'` unions,
 *      `theme: 'light'`, `mode="light"`) while leaving unrelated uses of the
 *      word "light" alone (e.g. a "light scan" intensity option).
 *
 * The sanctioned dark-variant form is the always-on `@custom-variant
 * dark (&)` in app/globals.css — it makes every `dark:` utility apply
 * unconditionally with no `.dark` class and no media query. That form is
 * explicitly allowed.
 *
 * Scanned roots: app/, components/, src/, lib/, auth.ts, middleware.ts.
 * Skipped: node_modules/, .next/, e2e/ (covered by #654), this script.
 *
 * Usage:
 *   node scripts/check-no-light-mode.mjs            # scan the tree
 *   node scripts/check-no-light-mode.mjs --selftest # verify the scanner
 *
 * Exit codes: 0 clean, 1 violations found (or selftest failure).
 */

import { readdir, readFile, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

const SEARCH_ROOTS = ["app", "components", "src", "lib", "auth.ts", "middleware.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".tmp", "test-results", "e2e"]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CSS_EXT = new Set([".css"]);

/**
 * Blank out `/* *​/` and `//` comments so we don't match inside prose.
 * Newlines are preserved so reported line numbers match the source file.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/([^:]|^)\/\/.*$/gm, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/**
 * Return a list of { rule, line } violations for one file's contents.
 * `ext` selects the CSS vs code rule set.
 */
export function scanContent(content, ext) {
  const violations = [];
  const isCss = CSS_EXT.has(ext);
  const code = stripComments(content);
  const lines = code.split("\n");

  lines.forEach((line, i) => {
    const n = i + 1;

    if (!isCss) {
      if (/\bfrom\s+['"]next-themes['"]/.test(line) || /require\(\s*['"]next-themes['"]\s*\)/.test(line)) {
        violations.push({ rule: "next-themes import", line: n });
      }
      // A `'light'`/`"light"` THEME literal — only when the line also mentions
      // dark/theme/mode, so non-theme uses of "light" are left alone.
      if (/['"]light['"]/.test(line) && /\bdark\b|\btheme\b|\bmode\b/i.test(line)) {
        violations.push({ rule: "light theme literal", line: n });
      }
    }

    if (/theme_choice/.test(line)) {
      violations.push({ rule: "theme_choice key", line: n });
    }

    if (isCss) {
      // `.dark` used as a selector (followed by selector punctuation/space).
      if (/\.dark(?=[\s.#\[:,){>~+]|$)/.test(line)) {
        violations.push({ rule: ".dark selector", line: n });
      }
      if (/prefers-color-scheme/.test(line)) {
        violations.push({ rule: "prefers-color-scheme media query", line: n });
      }
      // class/media-based custom-variant dark — allow only the (&) form.
      if (/@custom-variant\s+dark\b/.test(line) && !/@custom-variant\s+dark\s*\(\s*&\s*\)/.test(line)) {
        violations.push({ rule: "class/media @custom-variant dark", line: n });
      }
    }
  });

  return violations;
}

async function* walk(path) {
  let s;
  try {
    s = await stat(path);
  } catch {
    return;
  }
  if (s.isFile()) {
    yield path;
    return;
  }
  if (!s.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(path, entry.name));
    } else {
      yield join(path, entry.name);
    }
  }
}

async function scanTree() {
  const found = [];
  for (const root of SEARCH_ROOTS) {
    for await (const file of walk(join(DASHBOARD_ROOT, root))) {
      const ext = extname(file);
      if (!CODE_EXT.has(ext) && !CSS_EXT.has(ext)) continue;
      const content = await readFile(file, "utf8");
      for (const v of scanContent(content, ext)) {
        found.push({ file: relative(DASHBOARD_ROOT, file), ...v });
      }
    }
  }
  return found;
}

async function selftest() {
  const dir = await mkdtemp(join(tmpdir(), "no-light-mode-"));
  const cases = [
    ["a.tsx", `import { useTheme } from "next-themes";`, ".tsx", "next-themes import"],
    ["b.ts", `const k = "theme_choice";`, ".ts", "theme_choice key"],
    ["c.css", `.dark { --background: black; }`, ".css", ".dark selector"],
    ["d.css", `@media (prefers-color-scheme: light) { :root {} }`, ".css", "prefers-color-scheme media query"],
    ["e.css", `@custom-variant dark (&:is(.dark *));`, ".css", "class/media @custom-variant dark"],
    ["f.ts", `let t: 'dark' | 'light' = 'dark';`, ".ts", "light theme literal"],
    ["g.tsx", `<ModeCard mode="light">`, ".tsx", "light theme literal"],
    ["h.ts", `theme: 'light',`, ".ts", "light theme literal"],
  ];
  // Sanctioned forms that must NOT trigger.
  const negatives = [
    ["ok1.css", `@custom-variant dark (&);`, ".css"],
    ["ok2.tsx", `// removed next-themes; see app/globals.css`, ".tsx"],
    ["ok3.css", `/* mirror :root/.dark in globals */ :root { --x: 0; }`, ".css"],
    // A non-theme "light" value (scan intensity) must be left alone.
    ["ok4.ts", `{ value: 'light', label: 'Quick scan, common subdomains only' },`, ".ts"],
  ];

  let ok = true;
  for (const [name, body, ext, expected] of cases) {
    await writeFile(join(dir, name), body);
    const hits = scanContent(body, ext).map((v) => v.rule);
    if (!hits.includes(expected)) {
      console.error(`selftest FAIL: ${name} did not flag "${expected}" (got: ${hits.join(", ") || "none"})`);
      ok = false;
    }
  }
  for (const [name, body, ext] of negatives) {
    const hits = scanContent(body, ext);
    if (hits.length) {
      console.error(`selftest FAIL: ${name} should be clean but flagged: ${hits.map((v) => v.rule).join(", ")}`);
      ok = false;
    }
  }
  await rm(dir, { recursive: true, force: true });
  return ok;
}

async function main() {
  if (process.argv.includes("--selftest")) {
    const ok = await selftest();
    console.log(ok ? "check-no-light-mode.mjs: selftest passed" : "check-no-light-mode.mjs: selftest FAILED");
    process.exit(ok ? 0 : 1);
  }

  const violations = await scanTree();
  if (violations.length === 0) {
    console.log("check-no-light-mode.mjs: clean (single dark brand enforced)");
    process.exit(0);
  }

  console.error("check-no-light-mode.mjs: light-mode construct(s) found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.rule}`);
  }
  console.error(
    "\nThere is one immutable dark brand (#649). Remove the construct; do not reintroduce light mode.",
  );
  process.exit(1);
}

main();
