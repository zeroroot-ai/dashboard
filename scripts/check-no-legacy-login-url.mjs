#!/usr/bin/env node
/*
 * check-no-legacy-login-url.mjs
 *
 * Fails the build if any source file references the legacy login URL
 * `/dashboard/login/v2`. The canonical login route is `/login`.
 *
 * The 308 redirect stub that previously lived at
 * `app/dashboard/(guest)/login/v2/page.tsx` was removed one release after
 * Phase A of the auth-flow-hardening spec shipped. The allowlist is now
 * empty, every occurrence of the legacy path is a regression.
 *
 * Scanned roots: `app/`, `components/`, `src/`, `e2e/`, `middleware.ts`.
 * Skipped: `node_modules/`, `.next/`, `test-results/`, `*.bak` files.
 *
 * Exit codes:
 *   0, no hits outside the allowlist
 *   1, at least one unexpected hit (details printed to stderr)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

// Directories and entry files to search. Any new top-level source directory
// should be added here.
const SEARCH_ROOTS = [
  "app",
  "components",
  "src",
  "e2e",
  "middleware.ts",
];

// Files that are allowed to contain the literal `/dashboard/login/v2`.
// The 308 stub that previously qualified has been removed, the allowlist
// is now empty. Any new hit is a regression.
const ALLOWLIST = new Set();

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "test-results",
  "playwright-report",
  "dist",
  "build",
  "coverage",
]);

const SKIP_FILE_SUFFIXES = [".bak"];

// Source extensions we care about. Config files, markdown, etc. are also
// scanned, any type that could carry a URL should be flagged.
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".html",
  ".yaml",
  ".yml",
]);

const PATTERN = "/dashboard/login/v2";

/**
 * Convert a path to forward-slash form for portable allowlist matching.
 */
function toPosix(p) {
  return p.split(sep).join("/");
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
    if (!entry.isFile()) continue;
    if (SKIP_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;

    const dotIdx = entry.name.lastIndexOf(".");
    const ext = dotIdx === -1 ? "" : entry.name.slice(dotIdx).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const absPath = join(dir, entry.name);
    const relPath = toPosix(relative(DASHBOARD_ROOT, absPath));
    if (ALLOWLIST.has(relPath)) continue;

    const content = await readFile(absPath, "utf8");
    if (!content.includes(PATTERN)) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(PATTERN)) {
        hits.push({ file: relPath, line: i + 1, text: lines[i].trim() });
      }
    }
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
  if (info.isDirectory()) {
    await walk(abs, hits);
    return;
  }
  if (!info.isFile()) return;
  const relPath = toPosix(relative(DASHBOARD_ROOT, abs));
  if (ALLOWLIST.has(relPath)) return;
  const content = await readFile(abs, "utf8");
  if (!content.includes(PATTERN)) return;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(PATTERN)) {
      hits.push({ file: relPath, line: i + 1, text: lines[i].trim() });
    }
  }
}

async function main() {
  const hits = [];
  for (const entry of SEARCH_ROOTS) {
    await checkEntry(entry, hits);
  }

  if (hits.length === 0) {
    console.log(
      "[check-no-legacy-login-url] OK, no references to /dashboard/login/v2 outside the allowlisted stub."
    );
    process.exit(0);
  }

  console.error(
    `[check-no-legacy-login-url] FAIL, found ${hits.length} reference(s) to the legacy login URL.\n` +
      "Replace with '/login' (canonical). Allowlist is for the stub file only.\n"
  );
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-no-legacy-login-url] Unexpected error:", err);
  process.exit(2);
});
