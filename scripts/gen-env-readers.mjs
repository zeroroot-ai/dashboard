#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Generator: write `src/lib/env-readers.json`, the set of environment
 * variable names the dashboard source can read.
 *
 * Why this exists
 * ---------------
 * zeroroot-ai/charts#303 (ADR-0094 layer 2). The chart injects env vars into
 * the dashboard container, and its merge gate fails when it injects a name
 * that is absent from the dashboard's reader set. The chart vendors this
 * file, so the set must come from the repository that owns the readers.
 *
 * Extraction
 * ----------
 * The set over-approximates on purpose. From every `.ts`, `.tsx`, `.mjs` and
 * `.js` file in the tree that is not a test or a spec, it takes:
 *
 *   - every env-shaped token inside a string or a template literal. This
 *     covers the REQUIRED_ENV and OPTIONAL_ENV blocks of
 *     `src/lib/env-validator.ts` and `process.env["NAME"]`.
 *   - every env-shaped property read: `process.env.NAME`, `env.NAME`.
 *   - every `process.env.X` and `process.env["X"]` at any length, so a short
 *     name such as `CI` is in the set.
 *
 * It lists no helper. A set that MISSES a name makes the chart gate report a
 * live env var as dead, and deleting one of those boots a pod with an empty
 * value. A set with a name too many only hides one dead env var.
 *
 * A name in a comment is not a reader. A name in a test is not a reader.
 *
 * Usage
 *   node scripts/gen-env-readers.mjs          write the file
 *
 * The drift gate is `scripts/check-env-readers-fresh.mjs`.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ARTIFACT = "src/lib/env-readers.json";

/** A scan under these floors read the wrong tree, so it is refused. */
const MIN_FILES = 200;
const MIN_NAMES = 100;

const SOURCE_EXT = /\.(ts|tsx|mjs|js)$/;
const TEST_FILE = /\.(test|spec)\./;
const ENV_TOKEN = /[A-Z][A-Z0-9_]{2,}/g;
// A read through `process.env` counts at any length: `process.env.CI`.
const PROCESS_DOT = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const SHORT_NAME = /^[A-Z][A-Z0-9_]*$/;
const isWord = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * Env-shaped names one source file can read.
 *
 * A small scanner splits the text into code, comments and string bodies.
 * Comments are dropped. A whole-word env-shaped token counts when it is in a
 * string body, or when a `.` precedes it in code.
 */
export function namesInSource(src) {
  const names = new Set();
  const take = (text, base, inString) => {
    for (const m of text.matchAll(ENV_TOKEN)) {
      const start = m.index;
      const end = start + m[0].length;
      if (isWord(text[start - 1]) || isWord(text[end])) continue;
      if (inString || text[start - 1] === ".") names.add(m[0]);
    }
    if (!inString) {
      for (const m of text.matchAll(PROCESS_DOT)) {
        if (!isWord(text[m.index + m[0].length])) names.add(m[1]);
      }
    }
    return base;
  };

  let i = 0;
  let code = "";
  const flushCode = () => {
    take(code, 0, false);
    code = "";
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      code += " ";
      continue;
    }
    // A line comment starts a line or follows white space. `//` inside a URL
    // or a regular expression is not a comment, and reading it as one would
    // drop the rest of the line, which is the unsafe direction.
    if (c === "/" && next === "/" && (i === 0 || /\s/.test(src[i - 1]))) {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const indexed = /process\.env\[\s*$/.test(code);
      flushCode();
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j += 1;
        // A plain string ends at the line end. This stops a stray quote in a
        // regular expression from reading the rest of the file as a string.
        if (c !== "`" && src[j] === "\n") break;
        j += 1;
      }
      const body = src.slice(i + 1, j);
      take(body, 0, true);
      if (indexed && SHORT_NAME.test(body)) names.add(body);
      i = j + 1;
      code += " ";
      continue;
    }
    code += c;
    i += 1;
  }
  flushCode();
  return names;
}

/**
 * Directories that hold no dashboard source: dependencies, build output,
 * reports and local tool state. The image build runs this scan with no git
 * and no `.git` directory (`.dockerignore`), so the scan walks the tree. In a
 * clean checkout and in the image build the walk reads the same files.
 */
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".worktrees", ".turbo", ".vercel", ".vscode",
  ".claude", ".spec-workflow", "coverage", "playwright-report", "test-results",
  "dist", "build", "out",
]);

/** Source files under `root`, relative to it, that are not tests. */
function sourceFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name), childRel);
      } else if (ent.isFile() && SOURCE_EXT.test(ent.name) && !TEST_FILE.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        out.push(childRel);
      }
    }
  };
  walk(root, "");
  return out.sort();
}

/** The sorted reader set of the tree at `root`. Throws under the floors. */
export function scan(root, { minFiles = MIN_FILES, minNames = MIN_NAMES } = {}) {
  const files = sourceFiles(root);
  if (files.length < minFiles) {
    throw new Error(
      `scanned ${files.length} source file(s) in ${root}, the floor is ${minFiles}: this is not the dashboard tree`,
    );
  }
  const names = new Set();
  for (const f of files) {
    for (const n of namesInSource(readFileSync(join(root, f), "utf8"))) names.add(n);
  }
  if (names.size < minNames) {
    throw new Error(
      `found ${names.size} name(s) in ${files.length} file(s), the floor is ${minNames}: the scan read nothing`,
    );
  }
  // Code-unit order, the same on every machine and locale.
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function render(names) {
  return (
    JSON.stringify(
      {
        generatedBy: "scripts/gen-env-readers.mjs. Do not hand-edit. Refresh with `pnpm gen:env-readers`.",
        names,
      },
      null,
      2,
    ) + "\n"
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const names = scan(ROOT);
    writeFileSync(join(ROOT, ARTIFACT), render(names));
    console.log(`[gen-env-readers] wrote ${ARTIFACT} (${names.length} names)`);
  } catch (err) {
    console.error(`[gen-env-readers] FAIL: ${err.message}`);
    process.exit(2);
  }
}
