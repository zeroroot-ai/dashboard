#!/usr/bin/env node
/**
 * check-manifest-kind-required — fails CI when any of the three YAML
 * manifest schemas at core/sdk/{plugin,agent,tool}/manifest/schema.json
 * still treats `kind` as optional past the deprecation date.
 *
 * Pre-deprecation: log "ok (deprecation window active until DATE)".
 * Post-deprecation: exit non-zero with the offending file path.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 8.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 90 days post-spec landing. Edit this to extend or shorten the
// backward-compat window. The script will start failing CI on this
// date.
const DEPRECATION_END = new Date('2026-08-01T00:00:00Z');

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Workspace root is two levels up from enterprise/platform/dashboard/scripts
// (dashboard/scripts -> dashboard -> platform -> enterprise -> zeroroot.ai).
const WORKSPACE_ROOT = path.resolve(HERE, '..', '..', '..', '..');

const SCHEMAS = [
  'core/sdk/plugin/manifest/schema.json',
  'core/sdk/agent/manifest/schema.json',
  'core/sdk/tool/manifest/schema.json',
];

function main() {
  const now = new Date();
  if (now < DEPRECATION_END) {
    console.log(
      `[check-manifest-kind-required] ok — deprecation window active until ${DEPRECATION_END.toISOString().slice(0, 10)}`,
    );
    return 0;
  }

  const violations = [];
  for (const rel of SCHEMAS) {
    const abs = path.join(WORKSPACE_ROOT, rel);
    if (!existsSync(abs)) {
      // Schema not present in this checkout — skip silently. The
      // workspace layout is polyrepo; not every consumer has every
      // sibling repo cloned.
      continue;
    }
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
    console.log('[check-manifest-kind-required] ok — all schemas require `kind`');
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
