#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: no committed config may *enable* a test/debug escape hatch.
 *
 * The dashboard ships one sensitive route that is fail-closed behind a
 * single explicit env flag (404 unless the flag is set):
 *   - /api/debug/recent-errors    DASHBOARD_DEBUG=1            (error ring buffer)
 *
 * TEST_FIXTURES_ENABLED gated two fault-injection routes under /api/test.
 * Nothing used them, so the routes and the flag are gone (D78).
 *
 * TEST_AUTH_BYPASS was a fourth entry here. It gated a module that forged an
 * Auth.js session JWE, and it is gone: the module is deleted and the flag is
 * nothing. A flag cannot be set to its enabling value if nothing reads it, so
 * there is no contract left for this guard to lock. What replaced it is
 * check-no-session-forgery.mjs, which refuses the module coming back.
 *
 * The codebase deliberately does NOT gate these on `NODE_ENV`, that is the
 * forbidden anti-pattern enforced by check-no-nodeenv-conditioned-auth.mjs
 * (a prod image misconfigured to NODE_ENV=development would silently unlock
 * everything). Instead the contract is: the flag defaults absent and NO
 * committed, prod-bound config ever sets it to its enabling value.
 *
 * This guard locks that contract: it fails if any COMMITTED config file
 * (Dockerfile, .env.example, or any committed .env*) sets one of these flags
 * to its enabling value. Local-only `.env*.local` files are gitignored and
 * out of scope. The disabling value (e.g. `DASHBOARD_DEBUG=0`) is allowed -
 * documenting the default-off is encouraged.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// flag -> regex matching an *enabling* assignment
const DANGEROUS = [
  { flag: "DASHBOARD_DEBUG", enable: /\bDASHBOARD_DEBUG\s*[:=]\s*["']?1["']?/ },
  { flag: "NEXT_PUBLIC_DASHBOARD_DEBUG", enable: /NEXT_PUBLIC_DASHBOARD_DEBUG\s*[:=]\s*["']?1["']?/ },
];

// Candidate committed config files. Only scan ones that are tracked by git.
function trackedConfigFiles() {
  const candidates = ["Dockerfile"];
  for (const name of readdirSync(ROOT)) {
    if (/^\.env(\..*)?$/.test(name) && !/\.local$/.test(name)) candidates.push(name);
  }
  const tracked = [];
  for (const c of candidates) {
    const full = join(ROOT, c);
    if (!existsSync(full)) continue;
    try {
      // execFileSync with an argv array, NOT execSync with an interpolated
      // string. `c` is a filename read off disk by readdirSync, so it is
      // whatever the checkout happens to contain, and every name matching
      // /^\.env(\..*)?$/ reaches this line.
      //
      // The previous form was:
      //   execSync(`git ls-files --error-unmatch ${JSON.stringify(c)}`)
      //
      // JSON.stringify wraps the name in DOUBLE quotes, and the shell still
      // performs command substitution inside double quotes — `$(...)` and
      // backticks expand there. So a file named `.env.$(...)` executed its
      // contents as soon as this guard ran, which `pnpm prebuild` does on
      // every build. Quoting was not the fix; using a shell at all was the
      // bug. execFileSync passes argv straight to git with no shell to parse
      // it, so the filename can never be read as syntax.
      execFileSync("git", ["ls-files", "--error-unmatch", "--", c], {
        cwd: ROOT,
        stdio: "ignore",
      });
      tracked.push(c);
    } catch {
      // not tracked (gitignored), out of scope
    }
  }
  return tracked;
}

const violations = [];
for (const file of trackedConfigFiles()) {
  const src = readFileSync(join(ROOT, file), "utf8");
  src.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // comment line
    for (const { flag, enable } of DANGEROUS) {
      if (enable.test(line)) {
        violations.push(`${file}:${i + 1} enables ${flag} → "${line.trim()}"`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    "\ncheck-no-prod-debug-flags: committed config enables a test/debug escape hatch:\n",
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nThese routes must never be enabled by committed/prod-bound config. " +
      "Remove the enabling assignment (the flag defaults absent → routes 404).\n",
  );
  process.exit(1);
}

console.log("check-no-prod-debug-flags: ok");
