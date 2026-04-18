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
 * After the dashboard-social-providers spec, four OAuth2 callback routes
 * are the ONLY permitted HTTP handlers under app/api/auth/callback/:
 *   - app/api/auth/callback/github/route.ts
 *   - app/api/auth/callback/gitlab/route.ts
 *   - app/api/auth/callback/google/route.ts
 *   - app/api/auth/callback/microsoft/route.ts
 * Plus two pre-existing auth utility routes:
 *   - app/api/auth/forgot-password/route.ts
 *   - app/api/auth/providers/route.ts
 *
 * Any route file under app/api/auth/ that is NOT on this literal allowlist
 * will fail the build. The allowlist is intentionally a closed set — add
 * entries only with explicit justification and review.
 *
 * Runs as `prebuild`. Exits non-zero on first violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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

// ---------------------------------------------------------------------------
// Allowlist for app/api/auth/ route files.
//
// ONLY these paths are permitted. Any file under app/api/auth/ that is not
// on this list will fail the build. This is a closed, literal allowlist —
// no glob wildcards — to prevent future regressions.
//
// To add a new entry: get it reviewed, document why it is necessary, and
// add the exact relative path (from the repo root) below.
// ---------------------------------------------------------------------------
const AUTH_API_ROUTE_ALLOWLIST = new Set([
  // OAuth2 callback handlers — these are the ONLY permitted HTTP surface
  // for Better Auth. Required by the OAuth2 spec (providers redirect here).
  join("app", "api", "auth", "callback", "github", "route.ts"),
  join("app", "api", "auth", "callback", "gitlab", "route.ts"),
  join("app", "api", "auth", "callback", "google", "route.ts"),
  join("app", "api", "auth", "callback", "microsoft", "route.ts"),
  // Pre-existing non-Better-Auth utility routes.
  join("app", "api", "auth", "forgot-password", "route.ts"),
  join("app", "api", "auth", "providers", "route.ts"),
]);

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

/**
 * Walk app/api/auth/ and assert every file is in the allowlist.
 * Returns an array of violation strings for any unlisted file.
 */
function checkAuthApiAllowlist() {
  const authApiDir = join(ROOT, "app", "api", "auth");
  const found = [];
  walk(authApiDir, found);
  const violations = [];
  for (const fullPath of found) {
    const rel = relative(ROOT, fullPath);
    if (!AUTH_API_ROUTE_ALLOWLIST.has(rel)) {
      violations.push(
        `unlisted file under app/api/auth/: ${rel}\n` +
          `  This is a closed allowlist. Add the path to AUTH_API_ROUTE_ALLOWLIST in\n` +
          `  scripts/check-no-public-auth.mjs with justification if it belongs here.`,
      );
    }
  }
  return violations;
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

// Allowlist check — every file under app/api/auth/ must be on the list.
violations.push(...checkAuthApiAllowlist());

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
      "/api/admin/provisioning/* — that is a different trust boundary.\n" +
      "The dashboard-social-providers spec added exactly four OAuth2 callback\n" +
      "routes; no other files may live under app/api/auth/ without review.\n",
  );
  process.exit(1);
}

console.log("✓ check-no-public-auth: no public Better Auth surface detected");
