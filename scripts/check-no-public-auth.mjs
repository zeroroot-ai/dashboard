#!/usr/bin/env node
/**
 * Build guard: fail the build if anyone re-introduces the public Better
 * Auth HTTP surface or the client-side authClient.
 *
 * After the dashboard-auth-server-actions spec, the only way for browsers
 * to authenticate is through Server Actions in app/actions/auth/*. There
 * must be:
 *   - no `app/api/auth/[...all]/route.ts` (the catch-all)
 *   - no imports of `better-auth/react`
 *   - no references to `authClient.` in source code (excluding tests +
 *     this script)
 *
 * Runs as `prebuild`. Exits non-zero on first violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SCAN_DIRS = ["app", "src", "components", "hooks"];
const EXCLUDE = [
  "node_modules",
  ".next",
  "__tests__",
  ".test.",
  ".spec.",
  // self
  "scripts/check-no-public-auth.mjs",
];

const FORBIDDEN_PATHS = [
  // The Better Auth catch-all route MUST NOT exist.
  join("app", "api", "auth", "[...all]"),
];

const FORBIDDEN_PATTERNS = [
  { name: "import from better-auth/react", regex: /from\s+["']better-auth\/react["']/ },
  { name: "authClient.* usage", regex: /\bauthClient\s*\./ },
];

function shouldSkip(p) {
  return EXCLUDE.some((e) => p.includes(e));
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (shouldSkip(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (
      /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name)
    )
      out.push(full);
  }
  return out;
}

const violations = [];

// Forbidden paths
for (const p of FORBIDDEN_PATHS) {
  try {
    statSync(join(ROOT, p));
    violations.push(`forbidden path exists: ${p}`);
  } catch {
    /* good — it should not exist */
  }
}

// Pattern scan
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { name, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(body)) {
        violations.push(`${file}: ${name}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\n❌ check-no-public-auth: forbidden patterns detected.\n\n" +
      violations.map((v) => `  - ${v}`).join("\n") +
      "\n\nThe dashboard-auth-server-actions spec removed Better Auth's\n" +
      "public HTTP surface. Browser auth must go through Server Actions in\n" +
      "app/actions/auth/*. Workload-to-workload admin uses SPIFFE-authenticated\n" +
      "/api/admin/provisioning/* — that is a different trust boundary.\n",
  );
  process.exit(1);
}

console.log("✓ check-no-public-auth: no public Better Auth surface detected");
