#!/usr/bin/env node
/**
 * Build guard: fail the build if anyone re-introduces the legacy per-kind
 * PATCH route files that the access-matrix-finish spec retired.
 *
 * The shared `setComponentAccessAction` Server Action is the only write
 * path for per-item access toggles. These three HTTP routes were the
 * legacy binary on/off toggle and have been removed. Re-adding them
 * bypasses the deny-wins matrix and the audit emission path.
 *
 * Runs as `prebuild`. Exits non-zero on first violation.
 */

import { statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const FORBIDDEN_PATHS = [
  join("app", "api", "agents", "[name]", "route.ts"),
  join("app", "api", "tools", "[name]", "route.ts"),
  join("app", "api", "plugins", "[name]", "route.ts"),
];

const violations = [];

for (const rel of FORBIDDEN_PATHS) {
  try {
    statSync(join(ROOT, rel));
    violations.push(rel);
  } catch {
    /* good, it should not exist */
  }
}

if (violations.length > 0) {
  console.error(
    "\n❌ check-no-legacy-patch-endpoints: legacy binary-toggle routes detected.\n\n" +
      violations.map((v) => `  - ${v}`).join("\n") +
      "\n\nThe access-matrix-finish spec removed these routes. Per-item access\n" +
      "toggles must go through the shared `setComponentAccessAction` Server\n" +
      "Action (app/actions/crd/access.ts) so the deny-wins matrix and audit\n" +
      "emission path stay authoritative.\n",
  );
  process.exit(1);
}

console.log(
  "✓ check-no-legacy-patch-endpoints: no legacy PATCH route files present",
);
