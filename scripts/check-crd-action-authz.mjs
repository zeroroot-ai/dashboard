#!/usr/bin/env node
/**
 * Build guard: fail the build if any exported `*Action` function in
 * app/actions/crd/*.ts does not call requireCrdSession (or the
 * requireCrdSessionForSelfAction variant) as its first substantive step.
 *
 * Also rejects any new app/api/.../route.ts that imports from
 * @/src/lib/k8s/tenants or calls apply-/delete-/patch- helpers from that
 * module (Requirement 9, no public HTTP surface for CRD mutation).
 *
 * A file-level opt-out is supported via a marker comment
 *   // @crd-authz-exempt: <reason>
 * placed on the line IMMEDIATELY preceding the `export async function`.
 * Intended for rare cases; use a codeowner review to keep this honest.
 *
 * A route-level opt-out for app/api/.../route.ts files with a non-browser
 * trust boundary (e.g. Stripe-signature-verified webhooks) is supported via
 *   // @crd-authz-exempt-route: <reason>
 * anywhere in the top-of-file comment block. The reason MUST describe the
 * alternative auth boundary (e.g. "stripe-signature-verified").
 *
 * Runs as `prebuild` alongside check-no-public-auth.mjs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const CRD_ACTION_DIR = join(ROOT, "app", "actions", "crd");
const API_DIR = join(ROOT, "app", "api");

// Files in CRD_ACTION_DIR to skip when looking for action definitions.
function isCrdActionInternal(path) {
  const base = path.split("/").pop() ?? "";
  if (base.startsWith("_")) return true; // _authz.ts, _rate_limits.ts
  if (base === "types.ts") return true;
  if (base === "schemas.ts") return true;
  if (path.includes("__tests__")) return true;
  if (/\.(test|spec)\./.test(base)) return true;
  return false;
}

function walkTs(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// Matches: `export async function someAction(`, captures name and start index.
const ACTION_SIG = /^export\s+async\s+function\s+(\w+Action)\s*[<(]/gm;
const EXEMPT_MARKER = /\/\/\s*@crd-authz-exempt\s*:/;
const GATE_CALL = /\b(requireCrdSession|requireCrdSessionForSelfAction)\s*[<(]/;

// K8s-tenants write helpers that MUST NOT be called from public API routes.
const TENANTS_WRITE = [
  /\bapplyTenant\s*\(/,
  /\bdeleteTenant\s*\(/,
  /\bpatchTenant\s*\(/,
  /\bapplyTenantMember\s*\(/,
  /\bdeleteTenantMember\s*\(/,
  /\bpatchTenantMember\s*\(/,
  /\bapplyAgentEnrollment\s*\(/,
  /\bdeleteAgentEnrollment\s*\(/,
  /\bapplyComponentGrant\s*\(/,
  /\bdeleteComponentGrant\s*\(/,
  /\bgetBootstrapToken\s*\(/,
];

const K8S_TENANTS_IMPORT = /from\s+["']@\/src\/lib\/k8s\/tenants["']/;

const violations = [];

// --- Check 1: CRD action files ----------------------------------------------

const crdFiles = walkTs(CRD_ACTION_DIR).filter((f) => !isCrdActionInternal(f));
for (const file of crdFiles) {
  let body;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  let m;
  ACTION_SIG.lastIndex = 0;
  while ((m = ACTION_SIG.exec(body)) !== null) {
    const actionName = m[1];
    const sigStart = m.index;
    const lineNumber =
      body.slice(0, sigStart).split("\n").length; // 1-based line

    // Check for the exempt marker on the line immediately preceding.
    const before = body.slice(0, sigStart);
    const prevLineEnd = before.lastIndexOf("\n");
    const prevLineStart = before.lastIndexOf("\n", prevLineEnd - 1);
    const prevLine = before.slice(prevLineStart + 1, prevLineEnd);
    if (EXEMPT_MARKER.test(prevLine)) continue;

    // Find the end of this function: naive but good enough, the next
    // export-async-function signature or the end of file.
    const nextIdx = body.slice(sigStart + 1).search(ACTION_SIG);
    const funcBody = nextIdx === -1 ? body.slice(sigStart) : body.slice(sigStart, sigStart + 1 + nextIdx);

    if (!GATE_CALL.test(funcBody)) {
      violations.push(
        `${file}:${lineNumber}, CRD action '${actionName}' missing requireCrdSession call (or @crd-authz-exempt marker)`,
      );
    }
  }
}

// --- Check 2: app/api/**/route.ts must not write via k8s/tenants -----------

function walkRoutes(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (name === "route.ts" || name === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

const ROUTE_EXEMPT_MARKER = /\/\/\s*@crd-authz-exempt-route\s*:/;

for (const route of walkRoutes(API_DIR)) {
  let body;
  try {
    body = readFileSync(route, "utf8");
  } catch {
    continue;
  }
  const importsTenants = K8S_TENANTS_IMPORT.test(body);
  if (!importsTenants) continue;
  const writes = TENANTS_WRITE.filter((re) => re.test(body));
  if (writes.length === 0) continue;
  if (ROUTE_EXEMPT_MARKER.test(body)) continue;
  violations.push(
    `${route}, public API route imports @/src/lib/k8s/tenants and calls a write helper (forbidden, use Server Actions)`,
  );
}

if (violations.length > 0) {
  console.error(
    "\n\u274c check-crd-action-authz: violations detected.\n\n" +
      violations.map((v) => `  - ${v}`).join("\n") +
      "\n\nEvery CRD Server Action must pass through the authorization gate\n" +
      "implemented in app/actions/crd/_authz.ts (requireCrdSession or\n" +
      "requireCrdSessionForSelfAction). Public HTTP routes must not mutate\n" +
      "CRDs via @/src/lib/k8s/tenants. See the crd-server-action-authorization\n" +
      "spec for context.\n",
  );
  process.exit(1);
}

console.log("\u2713 check-crd-action-authz: all CRD actions are gated");
