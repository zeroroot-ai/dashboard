#!/usr/bin/env node
/**
 * check-no-tenantmember-crd-writes.mjs
 *
 * Build-time guard enforcing the dashboard#715/#716 cutover: member + role
 * management is owned by the daemon's MembershipService (ADR-0043/0044), and
 * the dashboard reads ListMembers, NOT the TenantMember CR.
 *
 * ## What is checked
 *
 * No code under app/ or components/ or src/ may:
 *   - call the removed TenantMember member-management helpers
 *     (listTenantMembers / patchTenantMember / deleteTenantMember), or
 *   - call applyTenantMember outside the single permitted provisioning path
 *     (app/actions/signup.ts, founding-owner creation, ADR-0044), or
 *   - reference the removed AgentEnrollment CRD (type or 'agentenrollments'
 *     plural, enrollment is gibson.agentidentity.v1.AgentIdentityService, no CRD).
 *
 * Comment lines (// , * , /* ) are skipped so the historical references in
 * doc-comments don't trip the guard.
 *
 * ## Usage
 *   node scripts/check-no-tenantmember-crd-writes.mjs            # FAIL on violation
 *   node scripts/check-no-tenantmember-crd-writes.mjs --selftest # assert detection
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-tenantmember-crd-writes.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SCAN_DIRS = ['app', 'components', 'src'];

// Files allowed to reference the listed symbols.
const ALLOWLIST = new Set([
  'src/lib/k8s/tenants.ts', // defines applyTenantMember (provisioning helper)
  'app/actions/signup.ts', // founding-owner creation during provisioning (ADR-0044)
]);

// Forbidden everywhere (the member-management helpers were removed entirely).
const FORBIDDEN_ALWAYS = [
  /\blistTenantMembers\s*\(/,
  /\bpatchTenantMember\s*\(/,
  /\bdeleteTenantMember\s*\(/,
  /\blistTenantMembers\b(?=[,}\s].*from)/, // import specifier
];

// Forbidden outside the allowlist.
const FORBIDDEN_UNLESS_ALLOWED = [
  /\bapplyTenantMember\b/,
  /\bAgentEnrollment\b/,
  /['"]agentenrollments['"]/,
];

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === '.next' || e === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

function scan() {
  const violations = [];
  for (const d of SCAN_DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const rel = relative(ROOT, file).split('\\').join('/');
      // Never scan this guard itself.
      if (rel.endsWith(SCRIPT_NAME)) continue;
      const allowed = ALLOWLIST.has(rel);
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        for (const re of FORBIDDEN_ALWAYS) {
          if (re.test(line)) violations.push(`${rel}:${i + 1}, removed TenantMember helper: ${line.trim()}`);
        }
        if (!allowed) {
          for (const re of FORBIDDEN_UNLESS_ALLOWED) {
            if (re.test(line)) violations.push(`${rel}:${i + 1}, TenantMember-write / AgentEnrollment outside allowlist: ${line.trim()}`);
          }
        }
      });
    }
  }
  return violations;
}

function main() {
  if (process.argv.includes('--selftest')) {
    const tmp = join(ROOT, 'app', `__guard_selftest_${Date.now()}.ts`);
    writeFileSync(tmp, 'import { patchTenantMember } from "x";\npatchTenantMember(ns, n, {});\n');
    try {
      const v = scan();
      const caught = v.some((x) => x.includes('__guard_selftest_'));
      if (!caught) {
        console.error(`${SCRIPT_NAME}: SELFTEST FAILED, scanner did not catch the synthetic violation`);
        process.exit(1);
      }
      console.log(`${SCRIPT_NAME}: selftest ok`);
    } finally {
      unlinkSync(tmp);
    }
    return;
  }

  const violations = scan();
  if (violations.length > 0) {
    console.error(`❌ ${SCRIPT_NAME}: violations detected.\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nMember/role management is owned by the daemon (MembershipService,\n' +
        'ADR-0043/0044). Read ListMembers; do not write TenantMember CRs. The only\n' +
        'permitted applyTenantMember caller is the signup provisioning path.\n' +
        'AgentEnrollment is gone, enrollment is gibson.agentidentity.v1.AgentIdentityService.',
    );
    process.exit(1);
  }
  console.log(`${SCRIPT_NAME}: clean`);
}

main();
