#!/usr/bin/env node
/**
 * check-no-secret-in-logs.mjs
 *
 * Build-time guard for spec `unified-identity-and-authorization` Phase 4
 * (R9.8). The dashboard's "Register Agent" route emits the component's
 * one-time `bootstrap_token` in exactly one place: the success-response
 * body of `POST /api/agents/register`. It must never reach a logger.
 * (Under the unified-identity model — ADR-0045, gibson#670 — the daemon
 * no longer mints a `client_secret`; the sole credential is the
 * Capability-Grant `bootstrap_token`. The legacy `client_secret` /
 * `clientSecret` tokens are kept in the deny-list as defense-in-depth.)
 *
 * This script scans every `.ts` / `.tsx` / `.mjs` source file under
 * `app/` and `src/` for log call sites whose argument list mentions the
 * literal `bootstrap_token`, `bootstrapToken`, `client_secret`, or
 * `clientSecret`. A match fails the build.
 *
 * Why narrow:
 *   - `bootstrapToken` is a real TypeScript identifier in the route /
 *     test code, so a generic "no bootstrapToken anywhere" rule would
 *     misfire. We only catch the pattern when it is being passed to a
 *     logger (`console.*`, `logger.*`, etc.).
 *   - `__tests__/` and `*.test.*` files are exempt, tests legitimately
 *     reference the field name in assertions.
 *
 * Self-test mode: `--selftest` writes a synthetic violator and asserts
 * the scanner catches it.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['app', 'src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '__tests__',
]);
const SKIP_FILE_MARKERS = ['.test.', '.spec.', '.stories.'];

/**
 * The regex matches `<sink>.<method>(...args...)` where `<sink>` is one
 * of the known logger names and any argument literally contains a
 * forbidden token. It is intentionally line-scoped, multi-line log
 * arguments are uncommon and the false-positive cost is too high to
 * scan with a full AST. If a multi-line log call appears in a future
 * change, fix the call to be single-line OR refactor the secret out
 * of the argument tree.
 */
const FORBIDDEN_TOKENS = [
  'bootstrap_token',
  'bootstrapToken',
  'client_secret',
  'clientSecret',
];

const LOGGER_PREFIXES = [
  'console',
  'logger',
  'log',
  'pino',
  'winston',
];

const LOGGER_RE = new RegExp(
  '\\b(?:' + LOGGER_PREFIXES.join('|') + ')\\s*\\.\\s*(?:log|info|warn|error|debug|trace|fatal)\\s*\\(',
);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (SKIP_FILE_MARKERS.some((m) => name.includes(m))) continue;
    if (full.includes(`${sep}e2e${sep}`)) continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

function scanFile(path) {
  const src = readFileSync(path, 'utf8');
  const violations = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    // Skip pure-comment lines.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    if (!LOGGER_RE.test(raw)) continue;
    for (const token of FORBIDDEN_TOKENS) {
      if (raw.includes(token)) {
        violations.push({ file: path, line: i + 1, text: raw.trim(), token });
      }
    }
  }
  return violations;
}

function runScan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    try {
      walk(abs, files);
    } catch {
      // Directory missing, skip.
    }
  }
  const violations = files.flatMap(scanFile);
  if (violations.length === 0) {
    console.log(`check-no-secret-in-logs.mjs: clean (${files.length} files scanned)`);
    return 0;
  }
  console.error('check-no-secret-in-logs.mjs found logger calls referencing a credential token:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}, references '${v.token}' inside a logger call`);
    console.error(`    ${v.text}`);
  }
  console.error('\nWhy this exists: spec unified-identity-and-authorization R9.8 -');
  console.error("the agent bootstrap_token is emitted exactly once in the API response;");
  console.error('it must NEVER reach a logger. Move the field out of the log arg list.');
  return 1;
}

function runSelftest() {
  const fixturePath = join(ROOT, 'src', '__check_secret_log_fixture.ts');
  const body = [
    '// Selftest fixture, references bootstrapToken inside a console.log call.',
    'export function bad() {',
    '  const bootstrapToken = "leaky";',
    '  console.log("registered agent", { bootstrapToken });',
    '}',
    '',
  ].join('\n');
  writeFileSync(fixturePath, body);
  try {
    const result = scanFile(fixturePath);
    if (result.length === 0) {
      console.error('check-no-secret-in-logs.mjs --selftest FAILED: scanner missed the violation.');
      return 1;
    }
    console.log(`check-no-secret-in-logs.mjs --selftest: OK (caught ${result.length} violation)`);
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
process.exit(mode === '--selftest' ? runSelftest() : runScan());
