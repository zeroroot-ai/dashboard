#!/usr/bin/env node
/*
 * check-no-legacy-product-name.mjs
 *
 * Fails the build if the pre-rebrand product name "Zero Day" (the old
 * "Zero Day AI") reappears on the customer surface. The product is
 * **Zero Root AI** (dashboard#704); the name lives in src/lib/brand.ts.
 *
 * Matches the brand name only, the lowercase/hyphenated security term
 * "zero-day" (as in a zero-day vulnerability) and the legacy domain
 * "zero-day.ai" are NOT flagged.
 *
 * Scanned roots: app/, components/, src/, content/, middleware.ts.
 * Skipped: node_modules, .next, generated bindings, test files.
 *
 * Exit codes: 0, clean; 1, at least one hit; 2, unexpected error.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

const SEARCH_ROOTS = ["app", "components", "src", "content", "middleware.ts"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "test-results",
  "playwright-report",
  "dist",
  "build",
  "coverage",
  "gen",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".html",
]);

// Brand name only: "Zero Day" with a real space. The hyphenated/lowercase
// security term "zero-day" and the domain "zero-day.ai" are deliberately not
// matched (they don't contain "Zero Day" with a capitalised space form).
const PATTERN = /Zero Day/;

function toPosix(p) {
  return p.split(sep).join("/");
}

function isTestFile(name) {
  return /\.(test|spec)\.[tj]sx?$/.test(name);
}

async function scanFile(absPath, relPath, hits) {
  const content = await readFile(absPath, "utf8");
  if (!PATTERN.test(content)) return;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (PATTERN.test(lines[i])) {
      hits.push({ file: relPath, line: i + 1, text: lines[i].trim() });
    }
  }
}

async function walk(dir, hits) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), hits);
      continue;
    }
    if (!entry.isFile() || isTestFile(entry.name)) continue;
    const dotIdx = entry.name.lastIndexOf(".");
    const ext = dotIdx === -1 ? "" : entry.name.slice(dotIdx).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const absPath = join(dir, entry.name);
    await scanFile(absPath, toPosix(relative(DASHBOARD_ROOT, absPath)), hits);
  }
}

async function checkEntry(entry, hits) {
  const abs = join(DASHBOARD_ROOT, entry);
  let info;
  try {
    info = await stat(abs);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  if (info.isDirectory()) return walk(abs, hits);
  if (info.isFile() && !isTestFile(entry)) {
    await scanFile(abs, toPosix(relative(DASHBOARD_ROOT, abs)), hits);
  }
}

async function selftest() {
  const ok = PATTERN.test('title="Connected to Zero Day AI"');
  const neg1 = PATTERN.test("Connected to Zero Root AI");
  const neg2 = PATTERN.test("a zero-day vulnerability in nginx");
  const neg3 = PATTERN.test('https://zero-day.ai/');
  const pass = ok && !neg1 && !neg2 && !neg3;
  console.log(
    pass
      ? "[check-no-legacy-product-name] selftest OK (brand matched; vuln-term + domain + new name not matched)"
      : "[check-no-legacy-product-name] selftest FAILED",
  );
  process.exit(pass ? 0 : 1);
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  const hits = [];
  for (const entry of SEARCH_ROOTS) await checkEntry(entry, hits);
  if (hits.length === 0) {
    console.log('[check-no-legacy-product-name] OK, no "Zero Day" brand literals.');
    process.exit(0);
  }
  console.error(
    `[check-no-legacy-product-name] FAIL, ${hits.length} "Zero Day" reference(s). ` +
      'The product is "Zero Root AI"; import PRODUCT_NAME from src/lib/brand.ts (chrome) ' +
      "or use the literal \"Zero Root AI\" (prose).\n",
  );
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-no-legacy-product-name] Unexpected error:", err);
  process.exit(2);
});
