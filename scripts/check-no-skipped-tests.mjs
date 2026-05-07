#!/usr/bin/env node
/**
 * check-no-skipped-tests.mjs
 *
 * Build-time guard enforcing spec `naming-and-config-standardization`
 * Requirements 3.5 and 3.6: no skipped tests in TypeScript test files.
 *
 * Scans src/**\/*.test.ts and src/**\/*.spec.ts for skip patterns on
 * non-comment lines:
 *   it.skip(    describe.skip(    test.skip(
 *   xit(        xdescribe(        xtest(
 *
 * Exclusions:
 *   - e2e/ Playwright directories (cluster-dependent — equivalent to build-tag gate)
 *   - src/lib/spiffe-mtls/__tests__/svid.test.ts (fixture-probe gate — itSkipIf)
 *   - __tests__/ dirs are allowed if the skip pattern is part of an itSkipIf call
 *     (conditional skip using a predicate, not a permanent skip)
 *
 * Self-test mode: `--selftest` writes a synthetic violating fixture, runs
 * the scan, asserts it catches the violation, then deletes the fixture.
 *
 * Wired into `scripts.prebuild` in package.json.
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUARD_NAME = "check-no-skipped-tests";

// Directories and file markers to exclude from the scan
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "e2e",           // Playwright e2e — cluster-dependent, equivalent to build-tag gate
]);

// Files explicitly exempt (fixture-probe gates equivalent to build tags)
const EXEMPT_FILES = new Set([
  join(ROOT, "src", "lib", "spiffe-mtls", "__tests__", "svid.test.ts"),
]);

// Forbidden patterns on non-comment lines in TS test files
const FORBIDDEN_PATTERNS = [
  { pattern: /\bit\.skip\s*\(/, label: "it.skip(" },
  { pattern: /\bdescribe\.skip\s*\(/, label: "describe.skip(" },
  { pattern: /\btest\.skip\s*\(/, label: "test.skip(" },
  { pattern: /\bxit\s*\(/, label: "xit(" },
  { pattern: /\bxdescribe\s*\(/, label: "xdescribe(" },
  { pattern: /\bxtest\s*\(/, label: "xtest(" },
];

// itSkipIf is a conditional skip (predicate-based) — exempt
const EXEMPT_PATTERNS = [
  /\bit\.skipIf\b/,
  /\btest\.skipIf\b/,
  /\bdescribe\.skipIf\b/,
];

function isCommentLine(raw) {
  const trimmed = raw.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function isExemptLine(raw) {
  return EXEMPT_PATTERNS.some((p) => p.test(raw));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Also skip e2e directories nested anywhere
      if (full.includes(`${sep}e2e${sep}`) || full.endsWith(`${sep}e2e`)) continue;
      walk(full, out);
      continue;
    }
    // Only scan .test.ts and .spec.ts files
    if (name.endsWith(".test.ts") || name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(filePath) {
  if (EXEMPT_FILES.has(filePath)) return [];
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isCommentLine(raw)) continue;
    if (isExemptLine(raw)) continue;
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      if (pattern.test(raw)) {
        violations.push({
          file: filePath,
          line: i + 1,
          text: raw.trim(),
          label,
        });
      }
    }
  }
  return violations;
}

function runScan() {
  const files = [];
  const srcDir = join(ROOT, "src");
  try {
    walk(srcDir, files);
  } catch {
    // src/ doesn't exist — nothing to scan
  }

  const allViolations = files.flatMap(scanFile);

  if (allViolations.length === 0) {
    console.log(`${GUARD_NAME}: clean (${files.length} test files scanned)`);
    return 0;
  }

  console.error(`\n[${GUARD_NAME}] FAIL: skipped test(s) found:\n`);
  for (const v of allViolations) {
    const rel = v.file.replace(ROOT, "").replace(/^\//, "");
    console.error(`  ${rel}:${v.line} — ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(`
Fix: remove the skip. Either delete the test (if the path under test no
longer exists) or un-skip it so it runs. Playwright e2e tests that require
a live cluster may use test.skip(condition, reason) — those live in e2e/
which is excluded from this scan.

Spec: naming-and-config-standardization Requirements 3.5, 3.6.`);
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, "src", "__check_no_skipped_tests_fixture.test.ts");
  const body = [
    "// Self-test fixture — intentionally uses a forbidden skip pattern.",
    "import { it, describe } from 'vitest';",
    "describe('selftest', () => {",
    "  it.skip('this should be caught', () => {});",
    "});",
    "",
  ].join("\n");
  writeFileSync(fixturePath, body);
  try {
    const result = scanFile(fixturePath);
    if (result.length === 0) {
      console.error(
        `[${GUARD_NAME}] selftest FAILED: scanner did not catch the synthetic violation.`,
      );
      return 1;
    }
    console.log(
      `[${GUARD_NAME}] --selftest: OK (caught ${result.length} violation(s))`,
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
process.exit(mode === "--selftest" ? runSelftest() : runScan());
