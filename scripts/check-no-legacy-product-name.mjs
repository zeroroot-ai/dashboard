#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/*
 * check-no-legacy-product-name.mjs
 *
 * Fails the build when a pre-rebrand name reappears anywhere in this tree.
 * The product is **Zero Root AI**, the org is **zeroroot-ai**, and the domain
 * is **zeroroot.ai**. The brand constant lives in src/lib/brand.ts.
 *
 * Four patterns, one guard:
 *
 *   legacy-product-name   "Zero Day"      (covers "Zero Day AI")
 *   legacy-domain         "zero-day.ai"
 *   legacy-slug           "zero-day-ai"
 *   legacy-daemon-domain  "gibson.io"
 *
 * "Zero Day" matches case-sensitively, so the security term "zero-day
 * vulnerability" is not flagged. The other three match case-insensitively.
 *
 * The whole repository is scanned. Exceptions live in
 * `.legacy-brand-allowlist.json`, which is keyed by content, never by line
 * number:
 *
 *   files  three whole-file exceptions: this guard (it declares the patterns it
 *          searches for), this allowlist (it quotes the lines it allows) and
 *          CHANGELOG.md (release-please writes it, and it records the rename).
 *   lines  one entry per tolerated line, keyed by the exact trimmed line text.
 *          An entry whose text no longer appears in its file fails the guard,
 *          so the allowlist cannot rot. Run `--shrink` to drop stale entries.
 *
 * Modes:
 *   (none)      scan the tree, report every hit outside the allowlist
 *   --shrink    remove allowlist line entries that no longer match
 *   --selftest  build fixtures, prove each pattern fires, prove a clean tree
 *               passes, prove the allowlist suppresses and prove a stale
 *               allowlist entry is reported
 *
 * Exit codes: 0 clean; 1 at least one hit or a stale allowlist entry; 2 error.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-no-legacy-product-name";
const DASHBOARD_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_NAME = ".legacy-brand-allowlist.json";
const ALLOWLIST_PATH = join(DASHBOARD_ROOT, ALLOWLIST_NAME);

const PATTERNS = [
  {
    name: "legacy-product-name",
    re: /Zero Day/,
    hint: 'the product is "Zero Root AI"; import PRODUCT_NAME from src/lib/brand.ts',
  },
  {
    name: "legacy-domain",
    re: /zero-day\.ai/i,
    hint: "the domain is zeroroot.ai",
  },
  {
    name: "legacy-slug",
    re: /zero-day-ai/i,
    hint: "the org slug is zeroroot-ai",
  },
  {
    name: "legacy-daemon-domain",
    re: /gibson\.io/i,
    hint: "gibson.io is not a Zero Root AI domain",
  },
];

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".tmp",
  ".worktrees",
  "node_modules",
  "build",
  "coverage",
  "dist",
  "out",
  "playwright-report",
  "test-results",
  "__screenshots__",
]);

const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

const SCANNED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cue",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SCANNED_NAMES = new Set(["Dockerfile", ".env.example"]);

function toPosix(p) {
  return p.split(sep).join("/");
}

function isScanned(name) {
  if (SKIP_FILES.has(name)) return false;
  if (SCANNED_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return SCANNED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Every scannable file under `root`, as workspace-relative posix paths. */
async function collectFiles(root, dir = root, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectFiles(root, join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile() || !isScanned(entry.name)) continue;
    out.push(toPosix(relative(root, join(dir, entry.name))));
  }
  return out;
}

function emptyAllowlist() {
  return { files: [], lines: [] };
}

async function loadAllowlist() {
  try {
    return JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyAllowlist();
    throw err;
  }
}

/**
 * Scan a tree.
 *
 * @param {string} root  directory to scan
 * @param {{files: {path: string}[], lines: {path: string, text: string}[]}} allowlist
 * @returns {Promise<{hits: object[], stale: object[]}>}
 */
async function scan(root, allowlist) {
  const exemptFiles = new Set((allowlist.files ?? []).map((e) => e.path));
  const allowedLines = new Map();
  for (const entry of allowlist.lines ?? []) {
    if (!allowedLines.has(entry.path)) allowedLines.set(entry.path, new Set());
    allowedLines.get(entry.path).add(entry.text);
  }

  const files = await collectFiles(root);
  const seen = new Map();
  const hits = [];

  for (const rel of files) {
    if (exemptFiles.has(rel)) continue;
    const content = await readFile(join(root, rel), "utf8");
    const allowedHere = allowedLines.get(rel);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i].trim();
      for (const pattern of PATTERNS) {
        if (!pattern.re.test(lines[i])) continue;
        if (allowedHere?.has(text)) {
          if (!seen.has(rel)) seen.set(rel, new Set());
          seen.get(rel).add(text);
          continue;
        }
        hits.push({ file: rel, line: i + 1, pattern: pattern.name, text, hint: pattern.hint });
      }
    }
  }

  const present = new Set(files);
  const stale = [];
  for (const entry of allowlist.files ?? []) {
    if (!present.has(entry.path)) stale.push({ ...entry, why: "file is gone" });
  }
  for (const entry of allowlist.lines ?? []) {
    if (!seen.get(entry.path)?.has(entry.text)) {
      stale.push({ ...entry, why: "no line in that file matches this text" });
    }
  }

  return { hits, stale };
}

function reportStale(stale) {
  process.stderr.write(
    `[${SCRIPT_NAME}] FAIL, ${stale.length} stale ${ALLOWLIST_NAME} entr(ies). ` +
      `Run \`node scripts/${SCRIPT_NAME}.mjs --shrink\` and commit the result.\n`,
  );
  for (const entry of stale) {
    process.stderr.write(`  ${entry.path}: ${entry.why}\n`);
  }
}

async function runScan() {
  const allowlist = await loadAllowlist();
  const { hits, stale } = await scan(DASHBOARD_ROOT, allowlist);

  if (hits.length > 0) {
    process.stderr.write(
      `[${SCRIPT_NAME}] FAIL, ${hits.length} legacy brand reference(s).\n`,
    );
    for (const hit of hits) {
      process.stderr.write(`  ${hit.file}:${hit.line} [${hit.pattern}] ${hit.text}\n`);
      process.stderr.write(`      ${hit.hint}\n`);
    }
    process.stderr.write(
      `\nFix the line. Add a content-keyed entry to ${ALLOWLIST_NAME} only when the ` +
        "string is the subject of the text itself.\n",
    );
    return 1;
  }

  if (stale.length > 0) {
    reportStale(stale);
    return 1;
  }

  process.stdout.write(
    `[${SCRIPT_NAME}] OK, no legacy brand reference outside ${ALLOWLIST_NAME}.\n`,
  );
  return 0;
}

async function runShrink() {
  const allowlist = await loadAllowlist();
  const { stale } = await scan(DASHBOARD_ROOT, allowlist);
  const dead = new Set(stale.map((e) => `${e.path}::${e.text ?? ""}`));
  const next = {
    files: (allowlist.files ?? []).filter((e) => !dead.has(`${e.path}::`)),
    lines: (allowlist.lines ?? []).filter((e) => !dead.has(`${e.path}::${e.text}`)),
  };
  const removed =
    (allowlist.files ?? []).length +
    (allowlist.lines ?? []).length -
    next.files.length -
    next.lines.length;
  writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`[${SCRIPT_NAME}] --shrink removed ${removed} stale entr(ies).\n`);
  return 0;
}

function writeFixture(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

async function runSelftest() {
  const root = mkdtempSync(join(tmpdir(), "legacy-brand-selftest-"));
  const failures = [];
  try {
    // One fixture per pattern, so a pattern that stops matching is named.
    writeFixture(root, "app/dirty-name.tsx", 'export const T = "Zero Day AI";\n');
    writeFixture(root, "docs/dirty-domain.md", "See https://zero-day.ai/docs.\n");
    writeFixture(root, "scripts/dirty-slug.mjs", '// github.com/zero-day-ai/gibson\n');
    writeFixture(root, "content/dirty-daemon.mdx", "Dial daemon.gibson.io:443.\n");
    // A compliant fixture, so a guard that always fails is caught too.
    writeFixture(
      root,
      "app/clean.tsx",
      'export const T = "Zero Root AI";\n// a zero-day vulnerability in nginx\n',
    );
    // An extension the guard does not scan must stay invisible.
    writeFixture(root, "app/ignored.bin", "Zero Day AI\n");

    const clean = await scan(root, emptyAllowlist());
    const byPattern = new Set(clean.hits.map((h) => h.pattern));
    for (const pattern of PATTERNS) {
      if (!byPattern.has(pattern.name)) failures.push(`pattern ${pattern.name} did not fire`);
    }
    if (clean.hits.some((h) => h.file === "app/clean.tsx")) {
      failures.push("the compliant fixture was reported as a hit");
    }
    if (clean.hits.some((h) => h.file === "app/ignored.bin")) {
      failures.push("an unscanned extension was reported as a hit");
    }

    // The allowlist must suppress, by file and by line content.
    const allowlist = {
      files: [{ path: "docs/dirty-domain.md", reason: "selftest" }],
      lines: [{ path: "app/dirty-name.tsx", text: 'export const T = "Zero Day AI";' }],
    };
    const suppressed = await scan(root, allowlist);
    if (suppressed.hits.some((h) => h.file === "docs/dirty-domain.md")) {
      failures.push("a whole-file allowlist entry did not suppress its file");
    }
    if (suppressed.hits.some((h) => h.file === "app/dirty-name.tsx")) {
      failures.push("a content-keyed allowlist entry did not suppress its line");
    }
    if (suppressed.stale.length > 0) {
      failures.push("a live allowlist entry was reported stale");
    }

    // A stale entry must be reported, so the allowlist cannot rot.
    const rotted = await scan(root, {
      files: [{ path: "docs/deleted.md" }],
      lines: [{ path: "app/clean.tsx", text: "this line does not exist" }],
    });
    if (rotted.stale.length !== 2) {
      failures.push(`expected 2 stale entries, got ${rotted.stale.length}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(`[${SCRIPT_NAME}] selftest FAILED:\n`);
    for (const f of failures) process.stderr.write(`  ${f}\n`);
    return 1;
  }
  process.stdout.write(
    `[${SCRIPT_NAME}] selftest OK (all ${PATTERNS.length} patterns fire, ` +
      "clean tree passes, allowlist suppresses, stale entries are reported).\n",
  );
  return 0;
}

async function main() {
  if (process.argv.includes("--selftest")) return runSelftest();
  if (process.argv.includes("--shrink")) return runShrink();
  return runScan();
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[${SCRIPT_NAME}] Unexpected error: ${err?.stack ?? err}\n`);
    process.exit(2);
  });
