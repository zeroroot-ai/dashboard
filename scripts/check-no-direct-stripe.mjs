#!/usr/bin/env node
/**
 * check-no-direct-stripe.mjs
 *
 * Build-time guard enforcing the Stripe single-entry-point invariant
 * (spec: stripe-billing-integration, R9.2):
 *
 *   No file other than `src/lib/billing/stripe.ts` may import the `stripe`
 *   npm package directly.
 *
 * Why: The `src/lib/billing/stripe.ts` wrapper enforces idempotency,
 * signature verification, configuration validation, and audit consistency
 * on every Stripe call. Direct `stripe` imports anywhere else bypass these
 * invariants and are a security / correctness regression.
 *
 * Forbidden patterns (in any `.ts` / `.tsx` / `.mjs` / `.js` file outside
 * the permitted module):
 *   - `import ... from 'stripe'`
 *   - `import ... from "stripe"`
 *   - `require('stripe')`
 *   - `require("stripe")`
 *
 * Exemptions:
 *   - `src/lib/billing/stripe.ts`, the permitted wrapper
 *   - `node_modules`, `.next`, `dist`, `build`, `coverage`, generated
 *   - `__tests__/`, `*.test.*`, `*.spec.*`, test files may reference the
 *     pattern when asserting the guard blocks a violation
 *   - `scripts/`, build scripts (this file, etc.) may import stripe for
 *     one-time admin tasks like `stripe-bootstrap.ts`
 *
 * Wired into `scripts.prebuild` in package.json.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The only file allowed to import from 'stripe'.
const PERMITTED_MODULE = join(ROOT, 'src', 'lib', 'billing', 'stripe.ts');

const SCAN_DIRS = ['app', 'src', 'components', 'lib', 'hooks'];
const SCAN_FILES = ['auth.ts', 'middleware.ts', 'instrumentation.ts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '__tests__',
  'scripts',
]);

const SKIP_FILE_MARKERS = ['.test.', '.spec.', '.stories.'];

// Patterns that indicate a direct stripe import.
// `import type` is exempted, type-only imports are erased at compile time
// and do not cause the stripe SDK to load at runtime. The wrapper invariant
// is about runtime loading, not type references.
const STRIPE_IMPORT_PATTERNS = [
  /import(?!\s+type\b)\s+.*?from\s+['"]stripe['"]/,
  /require\s*\(\s*['"]stripe['"]\s*\)/,
];

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
    if (SKIP_FILE_MARKERS.some((m) => name.includes(m))) continue;
    if (full.includes(`${sep}e2e${sep}`)) continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

function scanFile(path) {
  if (path === PERMITTED_MODULE) return [];

  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const violations = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    // Skip pure-comment lines.
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue;
    }
    for (const pattern of STRIPE_IMPORT_PATTERNS) {
      if (pattern.test(raw)) {
        violations.push({
          file: path,
          line: i + 1,
          text: raw.trim(),
        });
      }
    }
  }
  return violations;
}

function runScan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files);
  }
  for (const name of SCAN_FILES) {
    const abs = join(ROOT, name);
    try {
      if (statSync(abs).isFile()) files.push(abs);
    } catch {
      // File doesn't exist, fine.
    }
  }

  const violations = files.flatMap(scanFile);

  if (violations.length === 0) {
    console.log(
      `check-no-direct-stripe.mjs: clean (${files.length} files scanned)`,
    );
    return 0;
  }

  console.error(
    '❌ check-no-direct-stripe.mjs: direct stripe imports found outside the permitted wrapper:\n',
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    '\nAll Stripe SDK usage must go through `src/lib/billing/stripe.ts`.',
  );
  console.error(
    'That wrapper enforces idempotency, signature verification, and audit consistency.',
  );
  return 1;
}

process.exit(runScan());
