#!/usr/bin/env node
/**
 * check-no-localhost-defaults.mjs
 *
 * Build-time guard enforcing spec `naming-and-config-standardization`
 * Requirement 2.5: no localhost fallback expressions in config modules.
 *
 * The dashboard previously had || 'http://localhost:...' and
 * || 'bolt://localhost:...' fallbacks in src/lib/config.ts and
 * src/lib/redis-store.ts. These are silent production footguns, a missing
 * env var would cause the dashboard to silently dial localhost instead of
 * crashing fast. This guard prevents their reintroduction.
 *
 * Scanned files (narrow scope to avoid false positives in test fixtures):
 *   src/lib/config.ts
 *   src/lib/redis-store.ts
 *
 * Forbidden patterns (on non-comment lines):
 *   || 'http://localhost
 *   || 'https://localhost
 *   || 'bolt://localhost
 *   || 'redis://localhost
 *   || "http://localhost   (double-quote form)
 *   || "https://localhost
 *   || "bolt://localhost
 *   || "redis://localhost
 *
 * Self-test mode: `--selftest` writes a synthetic violating fixture,
 * runs the scan, asserts it catches the violation, then deletes the
 * fixture. Exit 0 if the guard works; non-zero if not.
 *
 * Wired into `scripts.prebuild` in package.json.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const GUARD_NAME = "check-no-localhost-defaults";

// Files to scan, intentionally narrow to avoid false positives in tests
// or .env.example (which legitimately uses localhost values as dev defaults).
const SCAN_FILES = [
  "src/lib/config.ts",
  "src/lib/redis-store.ts",
];

// Patterns that indicate a localhost fallback expression on a code line.
// We match the || operator followed by a localhost URL in a string literal.
const FORBIDDEN_PATTERNS = [
  { pattern: /\|\|\s*['"`]https?:\/\/localhost/, label: "http(s)://localhost fallback" },
  { pattern: /\|\|\s*['"`]bolt:\/\/localhost/, label: "bolt://localhost fallback" },
  { pattern: /\|\|\s*['"`]redis:\/\/localhost/, label: "redis://localhost fallback" },
  { pattern: /\|\|\s*['"`]127\.0\.0\.1/, label: "127.0.0.1 fallback" },
  { pattern: /\|\|\s*['"`]0\.0\.0\.0/, label: "0.0.0.0 fallback" },
];

function isCommentLine(raw) {
  const trimmed = raw.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function scanFile(filePath) {
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    // File doesn't exist, not a violation
    return [];
  }
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isCommentLine(raw)) continue;
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
  const allViolations = [];
  for (const rel of SCAN_FILES) {
    const abs = join(ROOT, rel);
    allViolations.push(...scanFile(abs));
  }

  if (allViolations.length === 0) {
    console.log(
      `${GUARD_NAME}: clean (${SCAN_FILES.length} files scanned)`,
    );
    return 0;
  }

  console.error(`\n[${GUARD_NAME}] FAIL: localhost fallback expression(s) found:\n`);
  for (const v of allViolations) {
    const rel = v.file.replace(ROOT, "").replace(/^\//, "");
    console.error(`  ${rel}:${v.line}, ${v.label}`);
    console.error(`    ${v.text}`);
  }
  console.error(`
Fix: remove the || 'http://localhost:...' (or bolt://, redis://) fallback
expression. Required variables must be validated via validateEnvConfig() in
src/lib/config.ts, the process should exit with a clear error if the env
var is unset. Optional variables should be typed as string | null with null
checked by consumers. See .env.example for local-dev placeholder values.

Spec: naming-and-config-standardization Requirement 2.5.`);
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, "src", "lib", "__check_no_localhost_defaults_fixture.ts");
  const body = [
    "// Self-test fixture, intentionally references a forbidden pattern.",
    "// The scan SHOULD catch this and exit non-zero.",
    "export const badDefault = process.env.MY_URL || 'http://localhost:9999';",
    "",
  ].join("\n");
  writeFileSync(fixturePath, body);
  try {
    // Temporarily add the fixture to the scan list
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
