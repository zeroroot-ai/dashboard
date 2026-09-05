#!/usr/bin/env node
/**
 * check-no-console-in-hooks.mjs
 *
 * Build-time guard enforcing spec `tier-0-cosmetic-cleanup` Requirement 3.5:
 * no file under `src/hooks/` may contain a direct `console.log`, `console.info`,
 * `console.error`, or `console.warn` call.
 *
 * Background: SSE/WebSocket hooks previously emitted lifecycle chatter
 * (`[WebSocket] Connected`, `[GraphSSE] Received event`, etc.) unconditionally
 * on every page load, visible in every customer's browser devtools. After the
 * Tier-0 cleanup, all such calls were removed or gated to NODE_ENV !== 'production'.
 * This guard prevents future re-accumulation.
 *
 * Forbidden pattern (line-level check):
 *   Any line containing `console.log`, `console.info`, `console.error`,
 *   or `console.warn` in a `.ts` or `.tsx` file under `src/hooks/`.
 *
 * Note: The guard is intentionally simple, it uses a line-level substring
 * check, not an AST parser. A `// console.log` comment line will be flagged;
 * that is by design: even commented-out calls are noise and should be removed.
 * Spec maintainers who genuinely need a comment should rephrase it without the
 * literal `console.` form.
 *
 * Exemptions:
 *   - `node_modules`, `.next`, `dist` directories inside src/hooks (none expected,
 *     but handled for safety).
 *   - Files that contain only type-level references (no executable call site)
 *     are still flagged if the substring appears on any line, keep call sites clean.
 *
 * Self-test mode: `--selftest`
 *   Creates `src/hooks/__selftest_console_guard.ts` with a single `console.log("test")`
 *   line, asserts the scanner finds exactly one violation, then deletes the file.
 *   Exit 0 on success, exit 1 if the scanner fails to detect the violation.
 *
 * Wired into the `prebuild` chain in `package.json` so every `pnpm build` run
 * executes this guard after the hook cleanup is in place.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOKS_DIR = join(ROOT, "src", "hooks");
const EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", "build"]);

// Forbidden console call substrings. Using substring match (not regex) intentionally:
// fast, no false negatives on the patterns we care about.
const FORBIDDEN = [
  "console.log",
  "console.info",
  "console.error",
  "console.warn",
];

/**
 * Recursively collect all .ts/.tsx files under a directory.
 */
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
    if (dot >= 0 && EXTENSIONS.has(name.slice(dot))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan a single file for forbidden console.* calls.
 * Returns an array of { file, line, text } violation objects.
 */
function scanFile(filePath) {
  const src = readFileSync(filePath, "utf8");
  const lines = src.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const forbidden of FORBIDDEN) {
      if (raw.includes(forbidden)) {
        violations.push({ file: filePath, line: i + 1, text: raw.trim() });
        break; // one violation per line is enough
      }
    }
  }
  return violations;
}

function runScan() {
  const files = walk(HOOKS_DIR);
  const violations = files.flatMap(scanFile);

  if (violations.length === 0) {
    console.log(
      `check-no-console-in-hooks.mjs: clean (${files.length} file(s) scanned under src/hooks/)`
    );
    return 0;
  }

  process.stderr.write(
    `\n❌ check-no-console-in-hooks.mjs: found ${violations.length} forbidden console.* call(s) in src/hooks/:\n\n`
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line}: ${v.text}\n`);
  }
  process.stderr.write(
    `\nWhy this exists: spec tier-0-cosmetic-cleanup Req 3.5, hooks run in the\n` +
    `customer's browser. Direct console.* calls produce visible chatter in devtools\n` +
    `on every page load. Remove the call or gate it:\n` +
    `  if (process.env.NODE_ENV !== 'production') { console.error(...); }\n\n`
  );
  return 1;
}

function runSelftest() {
  const fixturePath = join(HOOKS_DIR, "__selftest_console_guard.ts");
  const body = `// Self-test fixture for check-no-console-in-hooks.mjs\n// The guard SHOULD catch this line:\nconsole.log("selftest");\n`;
  writeFileSync(fixturePath, body);
  try {
    const violations = scanFile(fixturePath);
    if (violations.length === 0) {
      process.stderr.write(
        "❌ check-no-console-in-hooks.mjs --selftest FAILED: scanner did not catch the synthetic violation.\n"
      );
      return 1;
    }
    console.log(
      `check-no-console-in-hooks.mjs --selftest: OK (caught ${violations.length} violation in synthetic fixture)`
    );
    return 0;
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // best-effort cleanup
    }
  }
}

const mode = process.argv[2];
process.exit(mode === "--selftest" ? runSelftest() : runScan());
