#!/usr/bin/env node
/**
 * Build guard: fail the build if anyone re-introduces direct K8s access
 * to the legacy `llm-providers` Secret or the removed
 * `src/lib/k8s/provider-storage.ts` module.
 *
 * Spec 25 (`daemon-driven-provider-config`) moves all LLM-credential
 * storage to the daemon. The dashboard must no longer:
 *   - reference the Secret name `llm-providers` (anywhere — as a string
 *     literal, annotation value, label, etc.)
 *   - import or path-reference `src/lib/k8s/provider-storage`
 *   - call `readNamespacedSecret(...llm-provider...)` — even the
 *     single-line form is enough signal to block.
 *
 * SPIRE bundle Secrets and Langfuse Secrets are NOT affected — this
 * guard only looks for the `llm-providers` / `llm-provider` / provider
 * storage module references.
 *
 * ## Scope
 * Scans `src/`, `app/`, `components/`, `lib/` recursively for files
 * matching `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`. Skips `node_modules/`,
 * `.next/`, `.turbo/`, `dist/`, `coverage/`, `.git/`, and this script
 * family itself (they legitimately contain the banned patterns in
 * regex literals).
 *
 * Markdown (design docs, specs) is intentionally not scanned — docs
 * must be free to describe the removed surface.
 *
 * ## Comment-aware scanning
 * Whole-line comments (both `//` and C-style block comments) are
 * skipped — documentation describing what is banned is not itself a
 * violation.
 *
 * ## Escape valve
 * Add a literal line directly above the offending line:
 *   // eslint-disable-next-line gibson-no-llm-credential
 * The next non-blank, non-comment line is then skipped.
 *
 * Usage:
 *   node scripts/check-no-provider-k8s-access.mjs          # scan dashboard root
 *   node scripts/check-no-provider-k8s-access.mjs <path>   # scan specific dir
 *   node scripts/check-no-provider-k8s-access.mjs -h       # print usage
 *
 * Exit codes: 0 = clean, 1 = at least one violation.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// --------------------------------------------------------------------------
// Argument parsing.
// --------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  process.stdout.write(
    'check-no-provider-k8s-access — spec 25 static-analysis guard\n' +
      '\n' +
      'Usage:\n' +
      '  node scripts/check-no-provider-k8s-access.mjs [path]\n' +
      '\n' +
      'Scans the dashboard source tree for banned references to the\n' +
      "legacy `llm-providers` K8s Secret or the deleted\n" +
      '`src/lib/k8s/provider-storage.ts` module. Exits 1 if any match.\n' +
      '\n' +
      'Escape valve: add `// eslint-disable-next-line gibson-no-llm-credential`\n' +
      'directly above a line to skip the check for the next non-blank line.\n',
  );
  process.exit(0);
}

const ROOT = resolve(argv[0] ?? new URL('..', import.meta.url).pathname);
const SCAN_DIRS = ['src', 'app', 'components', 'lib'];

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.git',
]);

const EXCLUDE_FILES = new Set([
  'scripts/check-no-llm-credential-reads.mjs',
  'scripts/check-no-provider-k8s-access.mjs',
  'scripts/check-no-llm-credential-reads.test.mjs',
  'scripts/check-no-provider-k8s-access.test.mjs',
]);

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs)$/;

const ESCAPE_DIRECTIVE = 'eslint-disable-next-line gibson-no-llm-credential';

// --------------------------------------------------------------------------
// Banned patterns
// --------------------------------------------------------------------------
const BANNED = [
  {
    name: "`llm-providers` Secret reference",
    regex: /llm-providers/u,
    reason:
      "Secret name `llm-providers` is removed (spec 25). Provider configs " +
      'now live in daemon Redis behind ExecuteLLM/StreamLLM.',
  },
  {
    name: '`provider-storage` module reference',
    regex: /provider-storage/u,
    reason:
      'Module `src/lib/k8s/provider-storage.ts` is deleted (spec 25). ' +
      'All provider CRUD goes through the gRPC client in src/lib/gibson-client.ts.',
  },
  {
    name: 'readNamespacedSecret for LLM provider secret',
    // Single-line pattern: any `readNamespacedSecret(...)` call that
    // also mentions `llm-provider` on the same line (covers the common
    // shape `client.readNamespacedSecret('llm-providers', ns)`).
    regex: /readNamespacedSecret.*llm-provider/u,
    reason:
      '@kubernetes/client-node reads of the llm-provider Secret are ' +
      'banned — the dashboard has no K8s Secret path to LLM credentials.',
  },
];

// --------------------------------------------------------------------------
// File walker
// --------------------------------------------------------------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    const rel = relative(ROOT, full);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      if (EXCLUDE_FILES.has(rel)) continue;
      if (!SOURCE_EXT.test(ent.name)) continue;
      out.push(full);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Comment-aware line classifier — whole-line comment detection only.
// --------------------------------------------------------------------------
function classifyLines(src) {
  const lines = src.split(/\r?\n/);
  const flags = new Array(lines.length).fill(false);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inBlock) {
      flags[i] = true;
      if (trimmed.includes('*/')) {
        inBlock = false;
        const after = trimmed.split('*/').slice(1).join('*/').trim();
        if (after.length > 0) flags[i] = false;
      }
      continue;
    }
    if (trimmed.startsWith('//')) {
      flags[i] = true;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      flags[i] = true;
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
  }
  return { lines, flags };
}

// --------------------------------------------------------------------------
// Per-file scan
// --------------------------------------------------------------------------
function scanFile(fullPath) {
  let body;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }
  const { lines, flags } = classifyLines(body);
  const violations = [];
  const skipNext = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(ESCAPE_DIRECTIVE)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (flags[j]) continue;
        if (lines[j].trim().length === 0) continue;
        skipNext[j] = true;
        break;
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (flags[i]) continue;
    if (skipNext[i]) continue;
    const line = lines[i];
    for (const rule of BANNED) {
      if (rule.regex.test(line)) {
        violations.push({
          file: fullPath,
          line: i + 1,
          rule: rule.name,
          reason: rule.reason,
          content: line.trim().slice(0, 160),
        });
      }
    }
  }
  return violations;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files);
  }
  let violationCount = 0;
  for (const f of files) {
    const vs = scanFile(f);
    for (const v of vs) {
      const rel = relative(ROOT, v.file);
      process.stderr.write(
        `${rel}:${v.line}: ${v.rule} -> violation: ${v.reason}\n` +
          `    ${v.content}\n`,
      );
      violationCount++;
    }
  }
  if (violationCount > 0) {
    process.stderr.write(
      '\ncheck-no-provider-k8s-access: ' +
        `${violationCount} violation${violationCount === 1 ? '' : 's'} in ` +
        `${files.length} files scanned.\n` +
        'Dashboard must not touch LLM-credential K8s Secrets (spec 25).\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-no-provider-k8s-access: clean (${files.length} files scanned)\n`,
  );
  process.exit(0);
}

main();
