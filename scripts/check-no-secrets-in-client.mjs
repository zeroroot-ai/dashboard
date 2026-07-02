#!/usr/bin/env node
/**
 * Build guard: scan the compiled client bundles for leaked provider secrets.
 *
 * This is a belt-and-suspenders check on top of Next.js's own server-only
 * env-var handling. If a regression ever causes a social provider client
 * secret to appear in a client-side JS bundle, this script catches it in CI
 * before the build artifact is pushed.
 *
 * How it works:
 *   1. For each provider, read the client secret from the environment at
 *      script run time.
 *   2. If a secret is set and non-empty, grep all .js files under
 *      .next/static/ for a literal occurrence of the secret value.
 *   3. Any match → exit 1 with the offending file path and a redacted
 *      message. The actual secret value is NEVER printed to stdout/stderr.
 *
 * Secrets scanned (must stay in sync with src/lib/social-providers.ts):
 *   - GITHUB_CLIENT_SECRET
 *   - GITLAB_CLIENT_SECRET
 *   - GOOGLE_CLIENT_SECRET
 *   - MICROSOFT_CLIENT_SECRET
 *   - AUTH_SECRET / NEXTAUTH_SECRET (Auth.js HMAC; legacy BETTER_AUTH_SECRET removed)
 *
 * Runs as part of `prebuild` AFTER `next build` writes the output.
 * Important: this script is a no-op (succeeds silently) when the secret
 * env vars are not set, e.g. in a local build with no provider configured.
 * The check only activates when the secret is present in the environment,
 * which is precisely when it matters.
 *
 * Usage: node scripts/check-no-secrets-in-client.mjs
 *
 * Note: This script does NOT read secrets from any file on disk, only from
 * process.env at run time.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// The set of env var names whose values must never appear in client bundles.
// Keep this list in sync with src/lib/social-providers.ts.
const SECRET_ENV_VARS = [
  "GITHUB_CLIENT_SECRET",
  "GITLAB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  // Auth.js session HMAC. Both names are read because the platform is
  // mid-migration off the legacy BETTER_AUTH_SECRET name; either being
  // present in a client bundle is a critical regression.
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
];

// Read the active secrets from env at run time. Only secrets that are
// actually set (non-empty) are scanned for, if the secret is absent from
// the environment there is nothing to leak so no scan is needed.
const activeSecrets = SECRET_ENV_VARS
  .map((name) => ({ name, value: process.env[name] ?? "" }))
  .filter(({ value }) => value.length > 0);

if (activeSecrets.length === 0) {
  console.log(
    "✓ check-no-secrets-in-client: no provider secrets in env, nothing to scan",
  );
  process.exit(0);
}

// Locate the Next.js static client bundle directory.
const staticDir = join(ROOT, ".next", "static");

let staticDirExists = false;
try {
  statSync(staticDir);
  staticDirExists = true;
} catch {
  // .next/static doesn't exist, build hasn't run yet, or running in an
  // env without a prior `next build`. Skip silently; the guard is only
  // meaningful after a build.
}

if (!staticDirExists) {
  console.log(
    "✓ check-no-secrets-in-client: .next/static not found, skipping (run after `next build`)",
  );
  process.exit(0);
}

/**
 * Walk a directory recursively, collecting .js files.
 */
function walkJs(dir, out = []) {
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
      walkJs(full, out);
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const jsFiles = walkJs(staticDir);

if (jsFiles.length === 0) {
  console.log(
    "✓ check-no-secrets-in-client: no .js files found in .next/static, nothing to scan",
  );
  process.exit(0);
}

console.log(
  `check-no-secrets-in-client: scanning ${jsFiles.length} client bundle file(s) for ${activeSecrets.length} secret(s)…`,
);

const violations = [];

for (const filePath of jsFiles) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  for (const { name, value } of activeSecrets) {
    if (content.includes(value)) {
      // IMPORTANT: do NOT include the secret value in the violation message.
      violations.push(
        `${filePath}: contains the value of ${name}\n` +
          `  The secret value of ${name} was found verbatim in a client-side JS bundle.\n` +
          `  This is a CRITICAL security regression. Investigate immediately.\n` +
          `  (The secret value is not printed here to avoid logging it.)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\n❌ check-no-secrets-in-client: provider secret(s) found in client bundle!\n\n" +
      violations.map((v) => `  - ${v}`).join("\n\n") +
      "\n\nNext.js server-only env vars should never reach client bundles.\n" +
      "Possible causes:\n" +
      "  1. A server module that reads the secret is imported by a client component.\n" +
      "  2. The secret was passed as a prop from a server to a client component.\n" +
      "  3. A build plugin or custom webpack config inadvertently included it.\n" +
      "Consult the Next.js docs on server-only modules and the `server-only` package.\n",
  );
  process.exit(1);
}

console.log(
  `✓ check-no-secrets-in-client: no secrets found in ${jsFiles.length} client bundle file(s)`,
);
