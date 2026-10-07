#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: every environment variable `src/lib/env-validator.ts` declares
 * is read somewhere in the dashboard.
 *
 * Why this exists
 * ---------------
 * dashboard#182: sixteen names sat in REQUIRED_ENV and OPTIONAL_ENV with no
 * reader anywhere in the tree, among them four OAuth client-secret pairs and
 * the mail provider. The chart treats a name the dashboard declares as a
 * name the dashboard reads (`helm/contracts/dashboard-env-readers.txt` is
 * vendored from this tree), so an unread entry lets the chart inject a
 * value, or a secret, into a pod that never uses it. This is the
 * consumer-side assertion for the env layer (ADR-0094).
 *
 * Detection
 * ---------
 * A declaration is `name: 'X'` (REQUIRED_ENV) or a bare `'X',` list entry
 * (OPTIONAL_ENV) in the validator. A reader is `process.env.X` or `env.X`
 * (the validator's own `env` proxy) in any production source file outside
 * the validator. Tests, generated code and build output are never readers.
 *
 * The guard refuses to pass when it finds zero declarations.
 *
 * Self-test
 * ---------
 * `--selftest` points the scan at a fixture validator that declares one name
 * nothing reads and one name the tree does read, and asserts the first is
 * reported and the second is not.
 *
 * Exit codes: 0 = every declared name has a reader, 1 = at least one has none.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-env-declared-is-read";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = join(ROOT, "src", "lib", "env-validator.ts");

const PRODUCTION_ROOTS = ["app", "src", "components", "lib", "hooks"];
const PRODUCTION_FILES = ["auth.ts", "middleware.ts", "instrumentation.ts", "next.config.ts"];
const SOURCE_EXT = /\.(ts|tsx|mjs|js)$/;
const EXCLUDED_DIR = new Set(["node_modules", ".next", ".worktrees", "__tests__", "gen", "generated", "fixtures"]);
const EXCLUDED_FILE = /\.(test|spec)\.(ts|tsx|mjs)$|\.d\.ts$/;

const REQUIRED_RE = /name:\s*'([A-Z][A-Z0-9_]+)'/g;
const OPTIONAL_RE = /^\s+'([A-Z][A-Z0-9_]+)',\s*$/gm;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (SOURCE_EXT.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function productionFiles(validatorPath) {
  const files = [];
  for (const r of PRODUCTION_ROOTS) walk(join(ROOT, r), files);
  for (const f of PRODUCTION_FILES) {
    const p = join(ROOT, f);
    try {
      if (statSync(p).isFile()) files.push(p);
    } catch {
      // absent at the root, fine
    }
  }
  return files.filter((f) => resolve(f) !== resolve(validatorPath));
}

function declaredNames(validatorPath) {
  const text = readFileSync(validatorPath, "utf8");
  const names = new Set();
  for (const m of text.matchAll(REQUIRED_RE)) names.add(m[1]);
  for (const m of text.matchAll(OPTIONAL_RE)) names.add(m[1]);
  return [...names].sort();
}

function readerPattern(name) {
  // `process.env.X`, the validator's `env.X` proxy, or a string-keyed read
  // such as `source['X']` in deployment-profile.ts.
  return new RegExp(`\\b(?:process\\.env|env)\\.${name}\\b|\\[['"]${name}['"]\\]`);
}

/** Returns { declared, scanned, unread } for the validator at validatorPath. */
function scan(validatorPath) {
  const declared = declaredNames(validatorPath);
  const files = productionFiles(validatorPath);
  const sources = files.map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  const unread = declared.filter((name) => {
    const re = readerPattern(name);
    return !sources.some((s) => re.test(s.text));
  });
  return { declared, scanned: files.length, unread };
}

function report(result) {
  process.stdout.write(
    `${SCRIPT_NAME}: ${result.declared.length} names declared in ${relative(ROOT, VALIDATOR)}, ` +
      `${result.scanned} production files scanned\n`,
  );
  if (result.declared.length === 0) {
    process.stderr.write(`${SCRIPT_NAME}: FAIL, zero declarations found. A scan that sees nothing proves nothing.\n`);
    return 1;
  }
  if (result.unread.length > 0) {
    process.stderr.write(`${SCRIPT_NAME}: FAIL, ${result.unread.length} declared name(s) have no reader:\n`);
    for (const n of result.unread) process.stderr.write(`  ${n}\n`);
    process.stderr.write(
      `Read the variable where it is needed, or delete the entry. A name the validator declares and nothing ` +
        `reads lets the chart inject a value into a pod that never uses it (dashboard#182).\n`,
    );
    return 1;
  }
  return 0;
}

function selftest() {
  // One name nothing reads, one name the tree reads on every request.
  // A private directory that mkdtemp makes, not a guessable name in the
  // shared temp directory.
  const fixtureDir = mkdtempSync(join(tmpdir(), "env-validator-selftest-"));
  const fixture = join(fixtureDir, "env-validator.ts");
  let failures = 0;
  try {
    writeFileSync(
      fixture,
      "export const REQUIRED_ENV = [\n  { name: 'AUTH_SECRET', kind: 'string' },\n];\n" +
        "const OPTIONAL_ENV = [\n  'SELFTEST_NOBODY_READS_THIS',\n];\n",
    );
    const r = scan(fixture);
    if (!r.unread.includes("SELFTEST_NOBODY_READS_THIS")) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, a declared name nothing reads was not reported.\n`);
    }
    if (r.unread.includes("AUTH_SECRET")) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, AUTH_SECRET is read by the sign-in path and was reported.\n`);
    }
    if (r.declared.length !== 2) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, the fixture declares 2 names and the scan saw ${r.declared.length}.\n`);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
  if (failures === 0) {
    process.stdout.write(`${SCRIPT_NAME} --selftest: PASS, the guard rejects an unread name and accepts a read one.\n`);
    return 0;
  }
  return 1;
}

const args = process.argv.slice(2);
process.exit(args.includes("--selftest") ? selftest() : report(scan(VALIDATOR)));
