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
 * From every `.ts`, `.tsx`, `.mjs` and `.js` file in the tree that is not a
 * test or a spec, it takes the real env reads only (dashboard#294):
 *
 *   - `process.env.NAME` and `process.env["NAME"]`, at any length, so a short
 *     name such as `CI` is in the set;
 *   - `const { NAME, ... } = process.env`;
 *   - `env.NAME`, the reads through the env proxy of `src/lib/env-validator.ts`;
 *   - the names of the REQUIRED_ENV (`name: "NAME"`) and OPTIONAL_ENV
 *     (`"NAME"`) blocks, which the proxy reads with `process.env[name]`.
 *
 * Any other string or template literal is not a read: an error code such as
 * `WORKSPACE_NAME_TAKEN`, or a name in the text of a guard. Such a name in
 * the set hid a dead env var from the charts `env-consumed` check.
 *
 * A set that MISSES a name makes the chart gate report a live env var as
 * dead, and deleting one of those boots a pod with an empty value. So each
 * read form above stays, and a new read form needs a new rule here.
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
const MIN_NAMES = 50;

const SOURCE_EXT = /\.(ts|tsx|mjs|js)$/;
const TEST_FILE = /\.(test|spec)\./;
// A read through `process.env` counts at any length: `process.env.CI`.
const PROCESS_DOT = /process\.env\.([A-Z][A-Z0-9_]*)/g;
// A read through the env proxy of env-validator.ts: `env.NAME`, `env?.NAME`.
const ENV_DOT = /(^|[^A-Za-z0-9_$.])env\??\.([A-Z][A-Z0-9_]*)/g;
// `const { A, B: b, C = "x" } = process.env`.
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*process\.env\b/g;
const SHORT_NAME = /^[A-Z][A-Z0-9_]*$/;
const isWord = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * The names of the REQUIRED_ENV and OPTIONAL_ENV blocks: `name: "NAME"` in
 * REQUIRED_ENV, a whole-string `"NAME"` in OPTIONAL_ENV. Comment lines of a
 * block are skipped. The env proxy reads each with `process.env[name]`.
 */
export function validatorBlockNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/\b(REQUIRED_ENV|OPTIONAL_ENV)\b[^=;\n]*=\s*\[/g)) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < src.length && depth > 0) {
      if (src[j] === "[") depth += 1;
      else if (src[j] === "]") depth -= 1;
      j += 1;
    }
    const block = src
      .slice(m.index + m[0].length, j - 1)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    const re = m[1] === "REQUIRED_ENV" ? /\bname:\s*['"]([A-Z][A-Z0-9_]*)['"]/g : /['"]([A-Z][A-Z0-9_]*)['"]/g;
    for (const n of block.matchAll(re)) names.add(n[1]);
  }
  return names;
}

/**
 * Env-shaped names one source file can read.
 *
 * A small scanner splits the text into code, comments and string bodies.
 * Comments are dropped. In code, the read forms of the header count. A string
 * body counts only as the index of `process.env[...]`. The validator blocks
 * are read from the whole text (validatorBlockNames).
 */
export function namesInSource(src) {
  const names = validatorBlockNames(src);
  const take = (text, base, inString) => {
    if (inString) return base;
    for (const m of text.matchAll(PROCESS_DOT)) {
      if (!isWord(text[m.index + m[0].length])) names.add(m[1]);
    }
    for (const m of text.matchAll(ENV_DOT)) {
      if (!isWord(text[m.index + m[0].length])) names.add(m[2]);
    }
    return base;
  };

  let i = 0;
  let code = "";
  // The text with comments dropped and strings kept, for indirectReads.
  let kept = "";
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
      kept += " ";
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
      kept += src.slice(i, j + 1);
      i = j + 1;
      code += " ";
      continue;
    }
    code += c;
    kept += c;
    i += 1;
  }
  flushCode();
  for (const n of indirectReads(kept)) names.add(n);
  return names;
}

const LIT = String.raw`['"]([A-Z][A-Z0-9_]*)['"]`;

/**
 * Env reads through one level of indirection, from a text with no comments.
 * Each form keeps a real `process.env` read in the same file:
 *
 *   - `const K = "NAME"` and `process.env[K]`;
 *   - `function f(k) { ... process.env[k] ... }` and a call `f("NAME")`;
 *   - `const { NAME } = process.env`;
 *   - `const r = process.env` (or a parameter `r = process.env`) and
 *     `r["NAME"]` or `r.NAME`;
 *   - an array of names only, `["A", "B"]`, in a file that reads
 *     `process.env[k]` with an identifier `k`: the file loops over it.
 *
 * A string that none of these forms reaches is not a read.
 */
export function indirectReads(text) {
  const names = new Set();
  // A destructure reads from the text with strings kept, so a default
  // value such as `B = "x"` does not split it.
  for (const m of text.matchAll(DESTRUCTURE)) {
    for (const part of m[1].split(",")) {
      const key = part.split(/[:=]/)[0].trim();
      if (SHORT_NAME.test(key)) names.add(key);
    }
  }
  const dynamic = new Set();
  for (const m of text.matchAll(/process\.env\[\s*([A-Za-z_$][\w$]*)\s*\]/g)) dynamic.add(m[1]);
  if (dynamic.size > 0) {
    for (const m of text.matchAll(new RegExp(String.raw`\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*${LIT}`, "g"))) {
      if (dynamic.has(m[1])) names.add(m[2]);
    }
    const readers = [];
    for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
      const end = text.indexOf("\n}", m.index);
      const body = text.slice(m.index, end === -1 ? text.length : end + 2);
      if (dynamic.has(m[2]) && body.includes(`process.env[${m[2]}]`)) readers.push(m[1]);
    }
    for (const f of readers) {
      for (const m of text.matchAll(new RegExp(String.raw`(?<![\w$.])${f}\(\s*${LIT}`, "g"))) names.add(m[1]);
    }
    const ONLY_NAMES = new RegExp(String.raw`\[\s*(${LIT}\s*,\s*)*${LIT}\s*,?\s*\]`, "g");
    for (const m of text.matchAll(ONLY_NAMES)) {
      for (const n of m[0].matchAll(new RegExp(LIT, "g"))) names.add(n[1]);
    }
  }
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?::[^=;()]*)?=\s*process\.env\b(?!\s*[.[])/g)) {
    const r = m[1];
    for (const n of text.matchAll(new RegExp(String.raw`(?<![\w$.])${r}\s*\[\s*${LIT}\s*\]`, "g"))) names.add(n[1]);
    for (const n of text.matchAll(new RegExp(String.raw`(?<![\w$.])${r}\??\.([A-Z][A-Z0-9_]*)\b`, "g"))) names.add(n[1]);
  }
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
