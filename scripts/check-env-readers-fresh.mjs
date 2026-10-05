#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: the committed `src/lib/env-readers.json` matches the source.
 *
 * zeroroot-ai/charts vendors that file as the dashboard's env reader set
 * (charts#303, ADR-0094 layer 2). A stale file makes the chart gate wrong in
 * one of two ways: it reports a live env var as dead, or it lets the chart
 * inject a name nothing reads. This guard fails the build until the file is
 * refreshed, and it names each difference.
 *
 * The generator does not run in `prebuild`. A gate that diffs a file against
 * the generator that wrote it one step earlier cannot fail (dashboard#1019).
 *
 * Usage
 *   node scripts/check-env-readers-fresh.mjs
 *   node scripts/check-env-readers-fresh.mjs --selftest
 *
 * Resolution
 *   pnpm gen:env-readers, then commit src/lib/env-readers.json.
 *
 * Exit codes: 0 = fresh, 1 = stale or missing, 2 = the scan was refused.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ARTIFACT, ROOT, namesInSource, render, scan } from "./gen-env-readers.mjs";

const SCRIPT_NAME = "check-env-readers-fresh";

/** Compare the artifact text with the scanned names. */
function drift(artifactText, scanned) {
  let committed;
  try {
    committed = JSON.parse(artifactText).names;
  } catch {
    return { missing: scanned, stale: [], malformed: true };
  }
  if (!Array.isArray(committed)) return { missing: scanned, stale: [], malformed: true };
  const have = new Set(committed);
  const want = new Set(scanned);
  return {
    missing: scanned.filter((n) => !have.has(n)),
    stale: committed.filter((n) => !want.has(n)),
    malformed: false,
  };
}

/** Returns the exit code for the tree at `root`. */
function check(root, floors, log = console) {
  let scanned;
  try {
    scanned = scan(root, floors);
  } catch (err) {
    log.error(`[${SCRIPT_NAME}] FAIL: ${err.message}`);
    return 2;
  }
  let text;
  try {
    text = readFileSync(join(root, ARTIFACT), "utf8");
  } catch {
    log.error(`[${SCRIPT_NAME}] FAIL: ${ARTIFACT} is missing. Run pnpm gen:env-readers.`);
    return 1;
  }
  const { missing, stale, malformed } = drift(text, scanned);
  if (!malformed && missing.length === 0 && stale.length === 0 && text === render(scanned)) {
    log.log(`[${SCRIPT_NAME}] OK: ${ARTIFACT} matches the source (${scanned.length} names)`);
    return 0;
  }
  if (malformed) log.error(`[${SCRIPT_NAME}] ${ARTIFACT} is not the generated JSON shape`);
  for (const n of missing) log.error(`[${SCRIPT_NAME}] the source reads ${n} and ${ARTIFACT} does not list it`);
  for (const n of stale) log.error(`[${SCRIPT_NAME}] ${ARTIFACT} lists ${n} and the source no longer reads it`);
  log.error(`[${SCRIPT_NAME}] FAIL: ${ARTIFACT} is stale. Run pnpm gen:env-readers and commit the result.`);
  return 1;
}

function selftest() {
  const failures = [];
  const expect = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
  };
  const sorted = (set) => [...set].sort();

  // 1. Over-approximation: no helper list. Each shape of read is found.
  const found = sorted(
    namesInSource(
      [
        "const a = process.env.PROCESS_DOT;",
        'const b = process.env["PROCESS_INDEX"];',
        "const c = env.PROXY_READ;",
        "const d = durationOr('HELPER_ARG', 5);",
        "const REQUIRED = [{ name: 'DECLARED_NAME' }];",
        "const e = `prefix ${x} TEMPLATE_NAME`;",
        'const url = "https://example.test/x"; const f = env.AFTER_URL;',
        'const g = process.env.CI ? 1 : 2; const h = process.env["E2"];',
      ].join("\n"),
    ),
  );
  const wantFound = ["AFTER_URL", "CI", "DECLARED_NAME", "E2", "HELPER_ARG", "PROCESS_DOT", "PROCESS_INDEX", "PROXY_READ", "TEMPLATE_NAME"];
  expect("every shape of read is found", JSON.stringify(found) === JSON.stringify(wantFound), `got ${found.join(",")}`);

  // 2. A comment is not a reader. Neither is a lower-case string, a short
  //    token, a bare identifier, or a token inside a longer word.
  const none = sorted(
    namesInSource(
      [
        "// process.env.LINE_COMMENT was removed",
        "/* env.BLOCK_COMMENT */",
        "const x = 1; // env.TRAILING_COMMENT",
        'const y = "lower_case"; const z = "AB"; const BARE_IDENT = 1; const w = "xINSIDE_WORDy";',
      ].join("\n"),
    ),
  );
  expect("a comment is not a reader", none.length === 0, `got ${none.join(",")}`);

  // 3. The gate, on a real git tree: fresh passes, a missing name fails and
  //    is named, a stale name fails and is named, a test file adds nothing,
  //    and a scan under the floor is refused.
  const dir = mkdtempSync(join(tmpdir(), "env-readers-selftest-"));
  const quiet = { lines: [], log() {}, error(m) { this.lines.push(m); } };
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  try {
    write("src/a.ts", "export const a = process.env.LIVE_NAME;\n");
    write("src/a.test.ts", "const t = process.env.TEST_ONLY_NAME;\n");
    write("e2e/x.spec.ts", "const t = process.env.SPEC_ONLY_NAME;\n");
    write(ARTIFACT, render(["LIVE_NAME"]));
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "add", "-A"]);
    const floors = { minFiles: 1, minNames: 1 };

    expect("a fresh artifact passes", check(dir, floors, quiet) === 0, quiet.lines.join(" | "));

    write("src/b.ts", "export const b = process.env.ADDED_NAME;\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    quiet.lines = [];
    expect("a new reader fails the gate", check(dir, floors, quiet) === 1);
    expect("the new reader is named", quiet.lines.some((l) => l.includes("the source reads ADDED_NAME")), quiet.lines.join(" | "));

    write(ARTIFACT, render(["ADDED_NAME", "GONE_NAME", "LIVE_NAME"]));
    quiet.lines = [];
    expect("a dropped reader fails the gate", check(dir, floors, quiet) === 1);
    expect("the dropped reader is named", quiet.lines.some((l) => l.includes("lists GONE_NAME")), quiet.lines.join(" | "));

    quiet.lines = [];
    expect("a scan under the file floor is refused", check(dir, { minFiles: 200, minNames: 1 }, quiet) === 2);
    expect("the floor is named", quiet.lines.some((l) => l.includes("the floor is 200")), quiet.lines.join(" | "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`[${SCRIPT_NAME}] SELFTEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(`[${SCRIPT_NAME}] SELFTEST OK: the gate finds every shape of read, skips comments and tests, and names each drift`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  process.exit(check(ROOT));
}
