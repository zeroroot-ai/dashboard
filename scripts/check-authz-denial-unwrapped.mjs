#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * check-authz-denial-unwrapped.mjs
 *
 * Build-time guard: no caller reads an authorization denial with
 * `instanceof AuthzDeniedError`. Every caller goes through `authzDenial(err)`
 * or `permissionDeniedResult(err)` from `src/lib/auth/assert-authorized.ts`.
 *
 * ## Background
 *
 * The user-acting transport runs `assertAuthorized` inside every RPC. A
 * denial thrown there does not reach the caller as the `AuthzDeniedError`
 * itself: connect-es passes every error an interceptor throws through
 * `ConnectError.from`, and the caller gets a `ConnectError` that keeps the
 * denial only as `cause`. `instanceof AuthzDeniedError` on that shape is
 * false, so the caller falls through to its internal-error path.
 *
 * Measured 2026-09-29 on staging: a member pressed "Enable" on a connector
 * and saw "Something went wrong on our end" with a reference id, and the log
 * said `errorClass: internal` for a `relation-not-met` denial. Eighteen call
 * sites read the denial that way. `authzDenial(err)` reads both shapes; this
 * guard keeps every caller on it.
 *
 * ## What is checked
 *
 * Every `.ts` / `.tsx` file under the scan roots, except test files and the
 * helper module itself, must not contain `instanceof AuthzDeniedError`.
 *
 * ## Self-test
 *
 * Pass `--selftest` to write a throwaway file with the banned form and one
 * with the allowed form under a scan root, run the scanner, and assert the
 * first is caught and the second is not. Cleans up after itself.
 *
 * ## Usage
 *
 *   node scripts/check-authz-denial-unwrapped.mjs            # FAIL on any violation
 *   node scripts/check-authz-denial-unwrapped.mjs --selftest # assert detection
 *
 * Wired into `pnpm prebuild` and listed in check-guard-selftests.mjs.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-authz-denial-unwrapped.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['app', 'src', 'components'];
const HELPER = join('src', 'lib', 'auth', 'assert-authorized.ts');
const BANNED = /\binstanceof\s+AuthzDeniedError\b/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.worktrees', '__tests__', 'e2e']);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      yield full;
    }
  }
}

/** Every violation under `root`, as `{ file, line }`. */
export function scan(root) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file);
      if (rel === HELPER) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, i) => {
        if (BANNED.test(text)) violations.push({ file: rel.split(sep).join('/'), line: i + 1 });
      });
    }
  }
  return violations;
}

function selftest() {
  const dir = join(ROOT, 'src', `__selftest_${SCRIPT_NAME.replace(/\W/g, '_')}_${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const bad = join(dir, 'bad.ts');
  const good = join(dir, 'good.ts');
  writeFileSync(bad, 'export function f(err: unknown) { return err instanceof AuthzDeniedError; }\n');
  writeFileSync(good, 'export function f(err: unknown) { return authzDenial(err) !== null; }\n');
  let ok = true;
  try {
    const found = scan(ROOT).filter((v) => v.file.includes('__selftest_'));
    const badHit = found.some((v) => v.file.endsWith('bad.ts'));
    const goodHit = found.some((v) => v.file.endsWith('good.ts'));
    if (!badHit) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAIL: the banned form was not caught`);
      ok = false;
    }
    if (goodHit) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAIL: the allowed form was reported`);
      ok = false;
    }
  } finally {
    for (const f of [bad, good]) {
      try {
        unlinkSync(f);
      } catch {
        // already gone
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (ok) console.log(`[${SCRIPT_NAME}] SELFTEST OK: the banned form is caught, the allowed form passes`);
  return ok ? 0 : 1;
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const violations = scan(ROOT);
  if (violations.length > 0) {
    console.error(`[${SCRIPT_NAME}] FAIL: ${violations.length} site(s) read a denial with instanceof AuthzDeniedError.`);
    console.error('A denial from inside an RPC arrives as a ConnectError with the AuthzDeniedError as cause,');
    console.error('so instanceof is false there. Use authzDenial(err) or permissionDeniedResult(err) from');
    console.error('src/lib/auth/assert-authorized.ts.');
    for (const v of violations) console.error(`  ${v.file}:${v.line}`);
    return 1;
  }
  console.log(`[${SCRIPT_NAME}] OK: every denial is read through authzDenial / permissionDeniedResult`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
