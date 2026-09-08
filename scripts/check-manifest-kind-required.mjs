#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * check-manifest-kind-required, fails CI when any of the three YAML
 * manifest schemas at {plugin,agent,tool}/manifest/schema.json in the sdk
 * repository still treats `kind` as optional past the deprecation date.
 *
 * Pre-deprecation: log "ok (deprecation window active until DATE)".
 * Post-deprecation: exit non-zero with the offending file path.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 8.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRepoPath } from './lib/workspace-root.mjs';

// 90 days post-spec landing. Edit this to extend or shorten the
// backward-compat window. The script will start failing CI on this
// date.
const DEPRECATION_END = new Date('2026-08-01T00:00:00Z');

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The manifest schemas live in the sdk repository. The resolver takes a
// repository name and a path inside it, and finds the checkout by searching
// the ancestors of this one.
const SCHEMAS = [
  'plugin/manifest/schema.json',
  'agent/manifest/schema.json',
  'tool/manifest/schema.json',
];

function main() {
  const now = new Date();
  if (now < DEPRECATION_END) {
    console.log(
      `[check-manifest-kind-required] ok, deprecation window active until ${DEPRECATION_END.toISOString().slice(0, 10)}`,
    );
    return 0;
  }

  const violations = [];
  for (const rel of SCHEMAS) {
    const found = resolveRepoPath('sdk', rel, { from: HERE });
    if (!found) {
      // No sdk checkout nearby, so there is nothing to read. Every consumer
      // clones the repositories it needs, and dashboard-only CI clones none.
      continue;
    }
    const abs = found.path;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (err) {
      violations.push(`${rel}: failed to parse JSON: ${err.message}`);
      continue;
    }
    const required = parsed?.required;
    if (!Array.isArray(required) || !required.includes('kind')) {
      violations.push(
        `${rel}: \`kind\` is missing from \`required\` (deprecation window ended ${DEPRECATION_END.toISOString().slice(0, 10)})`,
      );
    }
  }

  if (violations.length === 0) {
    console.log('[check-manifest-kind-required] ok, all schemas require `kind`');
    return 0;
  }

  console.error('[check-manifest-kind-required] FAIL:');
  for (const v of violations) console.error('  - ' + v);
  console.error(
    '\nThe one-minor-release backward-compat window has passed. Add `kind` to ' +
      'the schema\'s `required` array, or extend DEPRECATION_END in this script with ' +
      'a comment explaining why.',
  );
  return 1;
}

process.exit(main());
