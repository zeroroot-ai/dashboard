#!/usr/bin/env node
/**
 * check-no-todo-stripe.mjs
 *
 * Build-time guard that prevents accumulation of `TODO: stripe` comments.
 * Each such comment represents ambiguous pending billing work; resolving or
 * deferring them keeps the codebase's billing implementation state explicit.
 *
 * Exits non-zero if any `TODO: stripe` comment is found in app/ or src/.
 *
 * Spec: stripe-billing-integration R11.2.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['app', 'src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
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
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

function scan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files);
  }

  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/TODO:\s*stripe/i.test(lines[i])) {
        violations.push({ file, line: i + 1, text: lines[i].trim() });
      }
    }
  }

  if (violations.length === 0) {
    console.log(`check-no-todo-stripe.mjs: clean (${files.length} files scanned)`);
    return 0;
  }

  console.error('❌ check-no-todo-stripe.mjs: TODO: stripe comments found:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error('\nResolve each by implementing (if in scope) or replacing with:');
  console.error('  // DEFERRED: <spec-name>: <reason>');
  return 1;
}

process.exit(scan());
