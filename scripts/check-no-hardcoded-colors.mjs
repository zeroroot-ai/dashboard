#!/usr/bin/env node
/**
 * check-no-hardcoded-colors.mjs
 *
 * Build-time guard enforcing the no-hardcoded-colors invariant from
 * dashboard#53. Every color in committed code under `app/**` and
 * `components/**` must come from a token declared in `app/globals.css`.
 * Raw hex, oklch, rgb, hsl, tailwind palette utilities, and inline-style
 * color literals are all rejected.
 *
 * The token system itself lives in `app/globals.css` + `app/themes.css`,
 * so those two files are explicitly exempted. Everywhere else, the path
 * forward is the semantic + specialty tokens documented in the
 * design-system doc (docs.git: repos/dashboard/design-system.md).
 *
 * Existing violations are captured in `.color-allowlist.json` at the
 * repo root. The list is monotonic-shrink only:
 *
 *   - New violation (not in allowlist) → FAIL.
 *   - Allowlist entry whose source line no longer matches → FAIL with
 *     a hint to run `--shrink` and commit the result.
 *
 * Modes:
 *
 *   (default)    Scan; compare to allowlist; fail on drift in either
 *                direction.
 *   --shrink     Regenerate `.color-allowlist.json` by removing entries
 *                that no longer match in source. Never adds new entries.
 *   --seed       One-shot: regenerate `.color-allowlist.json` from the
 *                current scan. Use ONCE at #53 land time to bootstrap
 *                the list; CI should reject this mode going forward.
 *   --selftest   Synthesises a temp file with one of each forbidden
 *                pattern, asserts the scanner catches them, cleans up.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_PATH = join(ROOT, ".color-allowlist.json");

const SCAN_ROOTS = ["app", "components"];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx"]);
const CSS_EXTENSIONS = new Set([".css"]);

const EXEMPT_FILES = new Set([
  "app/globals.css",
  "app/themes.css",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", "dist", "build", "__tests__", "__snapshots__",
  ".turbo", "coverage",
]);

const TAILWIND_COLOR_PREFIXES = [
  "bg", "text", "border", "fill", "stroke", "shadow",
  "from", "to", "via", "ring", "outline", "decoration",
  "divide", "placeholder", "caret", "accent",
];
const TAILWIND_PREFIX_GROUP = TAILWIND_COLOR_PREFIXES.join("|");

const TAILWIND_PALETTE = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];
const TAILWIND_PALETTE_GROUP = TAILWIND_PALETTE.join("|");

const TAILWIND_SHADES = "(50|100|200|300|400|500|600|700|800|900|950)";

const CODE_PATTERNS = [
  {
    name: "tw-arbitrary-color",
    re: new RegExp(
      `\\b(${TAILWIND_PREFIX_GROUP})-\\[(#[0-9a-fA-F]+|oklch\\(|rgb\\(|rgba\\(|hsl\\(|hsla\\()`,
      "g",
    ),
  },
  {
    name: "tw-palette",
    re: new RegExp(
      `\\b(${TAILWIND_PREFIX_GROUP})-(${TAILWIND_PALETTE_GROUP})-${TAILWIND_SHADES}(\\/\\d+)?\\b`,
      "g",
    ),
  },
  {
    name: "tw-black-white",
    re: new RegExp(
      `\\b(bg|text|border|ring|outline|fill|stroke|shadow|from|to|via)-(black|white)(\\/\\d+)?\\b`,
      "g",
    ),
  },
  {
    name: "inline-style-color",
    re: /style=\{\{[^}]*?(?:color|backgroundColor|background|borderColor|fill|stroke|boxShadow|textShadow|outlineColor)[^}]*?(#[0-9a-fA-F]{3,8}|oklch\(|rgb\(|rgba\(|hsl\(|hsla\()/g,
  },
];

const CSS_PATTERNS = [
  {
    name: "css-hex",
    re: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "css-oklch-raw",
    re: /oklch\(\s*[0-9.]/g,
  },
  {
    name: "css-rgb-raw",
    re: /rgb\(\s*[0-9]/g,
  },
  {
    name: "css-rgba-raw",
    re: /rgba\(\s*[0-9]/g,
  },
  {
    name: "css-hsl-raw",
    re: /hsl\(\s*[0-9]/g,
  },
  {
    name: "css-hsla-raw",
    re: /hsla\(\s*[0-9]/g,
  },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = name.slice(dot);
    if (CODE_EXTENSIONS.has(ext) || CSS_EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
  return out;
}

function relPath(abs) {
  return relative(ROOT, abs).split(sep).join("/");
}

function scanFile(absPath) {
  const rel = relPath(absPath);
  if (EXEMPT_FILES.has(rel)) return [];

  const ext = rel.slice(rel.lastIndexOf("."));
  const isCss = CSS_EXTENSIONS.has(ext);
  const patterns = isCss ? CSS_PATTERNS : CODE_PATTERNS;

  let src;
  try {
    src = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const lines = src.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure comments early — they're noise we don't want to flag.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        violations.push({
          file: rel,
          line: i + 1,
          pattern: name,
          match: m[0],
          text: line.trim(),
        });
      }
    }
  }
  return violations;
}

function scanAll() {
  const files = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root)));
  return files.flatMap(scanFile);
}

function violationKey(v) {
  // file + line + pattern is enough to identify a unique violation slot.
  // Including `text` would force allowlist churn on every unrelated line edit.
  return `${v.file}:${v.line}:${v.pattern}`;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(`❌ failed to parse ${ALLOWLIST_PATH}: ${err.message}\n`);
    process.exit(1);
  }
}

function writeAllowlist(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.pattern < b.pattern ? -1 : 1;
  });
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function runScan() {
  const violations = scanAll();
  const allowlist = loadAllowlist();

  const violationByKey = new Map(violations.map((v) => [violationKey(v), v]));
  const allowByKey = new Map(allowlist.map((a) => [violationKey(a), a]));

  const fresh = []; // in scan, not in allowlist
  const stale = []; // in allowlist, no longer in scan
  const moved = []; // in both but text changed

  for (const [k, v] of violationByKey) {
    if (!allowByKey.has(k)) fresh.push(v);
  }
  for (const [k, a] of allowByKey) {
    if (!violationByKey.has(k)) stale.push(a);
    else {
      const v = violationByKey.get(k);
      if (a.match !== v.match) moved.push({ allow: a, found: v });
    }
  }

  const problems = fresh.length + stale.length + moved.length;
  if (problems === 0) {
    console.log(
      `check-no-hardcoded-colors.mjs: clean (${violations.length} known violation(s) in .color-allowlist.json)`,
    );
    return 0;
  }

  if (fresh.length > 0) {
    process.stderr.write(
      `\n❌ ${fresh.length} new hardcoded color violation(s) — every color goes through a token:\n\n`,
    );
    for (const v of fresh) {
      process.stderr.write(`  ${v.file}:${v.line} [${v.pattern}]  ${v.match}\n`);
      process.stderr.write(`    ${v.text}\n`);
    }
    process.stderr.write(
      "\nFix: replace with a semantic token (bg-background, text-foreground, " +
        "border-border) or a specialty token (text-highlight, text-alt, text-link). " +
        "See docs.git → repos/dashboard/design-system.md.\n",
    );
  }
  if (stale.length > 0) {
    process.stderr.write(
      `\n❌ ${stale.length} stale .color-allowlist.json entry/entries — source line no longer matches:\n\n`,
    );
    for (const a of stale) {
      process.stderr.write(`  ${a.file}:${a.line} [${a.pattern}]  was: ${a.match}\n`);
    }
    process.stderr.write(
      "\nFix: run `node scripts/check-no-hardcoded-colors.mjs --shrink` and commit " +
        "the updated allowlist.\n",
    );
  }
  if (moved.length > 0) {
    process.stderr.write(
      `\n❌ ${moved.length} allowlist entry/entries match a different color than recorded:\n\n`,
    );
    for (const { allow, found } of moved) {
      process.stderr.write(
        `  ${allow.file}:${allow.line} [${allow.pattern}]  allowlisted: ${allow.match}, found: ${found.match}\n`,
      );
    }
    process.stderr.write(
      "\nFix: the code changed at an allowlisted line but the new value is still a " +
        "hardcoded color. Replace with a token, or run `--shrink` if the new value " +
        "is intentional and the allowlist should track it.\n",
    );
  }
  return 1;
}

function runShrink() {
  const violations = scanAll();
  const allowlist = loadAllowlist();
  const violationByKey = new Map(violations.map((v) => [violationKey(v), v]));

  const before = allowlist.length;
  const kept = allowlist
    .filter((a) => violationByKey.has(violationKey(a)))
    .map((a) => {
      const v = violationByKey.get(violationKey(a));
      return { file: v.file, line: v.line, pattern: v.pattern, match: v.match };
    });
  writeAllowlist(kept);
  console.log(
    `check-no-hardcoded-colors.mjs --shrink: allowlist ${before} → ${kept.length} entries.`,
  );
  return 0;
}

function runSeed() {
  const violations = scanAll();
  const seeded = violations.map((v) => ({
    file: v.file,
    line: v.line,
    pattern: v.pattern,
    match: v.match,
  }));
  writeAllowlist(seeded);
  console.log(
    `check-no-hardcoded-colors.mjs --seed: wrote ${seeded.length} entries to .color-allowlist.json.`,
  );
  return 0;
}

function runSelftest() {
  const fixturePath = join(ROOT, "app", "__selftest_color_guard.tsx");
  const body = [
    'export const A = <div className="bg-[#ff00aa] text-emerald-500 border-white" />;',
    'export const B = <div style={{ color: "#abcdef" }} />;',
  ].join("\n");
  writeFileSync(fixturePath, body);
  try {
    const violations = scanFile(fixturePath);
    const patterns = new Set(violations.map((v) => v.pattern));
    const want = new Set([
      "tw-arbitrary-color",
      "tw-palette",
      "tw-black-white",
      "inline-style-color",
    ]);
    const missing = [...want].filter((p) => !patterns.has(p));
    if (missing.length > 0) {
      process.stderr.write(
        `❌ --selftest FAILED: scanner missed pattern(s): ${missing.join(", ")}\n`,
      );
      return 1;
    }
    console.log(
      `check-no-hardcoded-colors.mjs --selftest: OK (caught all ${want.size} pattern classes).`,
    );
    return 0;
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // best-effort
    }
  }
}

const mode = process.argv[2];
let code;
switch (mode) {
  case "--seed":
    code = runSeed();
    break;
  case "--shrink":
    code = runShrink();
    break;
  case "--selftest":
    code = runSelftest();
    break;
  default:
    code = runScan();
}
process.exit(code);
