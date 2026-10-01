// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * check-no-session-forgery.mjs — nothing in this tree mints an Auth.js session.
 *
 * The dashboard used to ship src/lib/test-fixtures/encode-session.ts, which
 * issued a synthetic session JWE that decrypted under the real AUTH_SECRET. It
 * was guarded by NODE_ENV !== "production" AND TEST_AUTH_BYPASS=1, and the
 * guards worked — nothing ever ran it in production.
 *
 * It was removed anyway, because the guards were not the problem. A module that
 * forges a session is a second way to be authenticated, and the one-code-path
 * rule (ADR-0027) says there is one. Every env flag that gates a second
 * codepath is a flag somebody can set.
 *
 * So this guard replaces the flag. It fails if any file imports Auth.js's token
 * `encode` — the primitive that mints a session cookie — anywhere outside the
 * auth configuration itself. Decoding is untouched: reading a session is what
 * the app does on every request. Minting one is what only the sign-in flow may
 * do, and the sign-in flow does it inside Auth.js, not by calling `encode`.
 *
 * Why this and not a grep for the deleted file: the file name is incidental. A
 * reader who wants an authenticated browser in a test will reach for the same
 * primitive under a different name, and the primitive is what this names.
 *
 *   node scripts/check-no-session-forgery.mjs             0 clean, 1 on a finding
 *   node scripts/check-no-session-forgery.mjs --selftest  prove it still fails
 */

import { readdir, readFile, stat, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

const SCAN_ROOTS = ["src", "e2e", "app", "components", "lib"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".git", "gen"]);

/**
 * The one place a session may legitimately be minted. Auth.js reads its own
 * jwt.encode override from here, which is the supported extension point; it is
 * not a second codepath, it IS the codepath.
 *
 * Keyed by path, not by line, and there is exactly one. A second entry wants a
 * paragraph saying why a second place mints sessions.
 */
const ALLOWED = new Set(["src/lib/auth.ts", "src/lib/auth.config.ts", "auth.ts", "auth.config.ts"]);

/**
 * An import of `encode` from Auth.js's jwt module, under either specifier.
 * next-auth/jwt re-exports @auth/core/jwt, so both resolve to the same function
 * and both have to be named.
 */
const FORGERY_IMPORT =
  /import\s*(?:type\s*)?\{[^}]*\bencode\b[^}]*\}\s*from\s*["'](?:next-auth\/jwt|@auth\/core\/jwt)["']/;

/** A namespace import is the same capability wearing a different shape. */
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s*["'](?:next-auth\/jwt|@auth\/core\/jwt)["']/;

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
      continue;
    }
    if (SCAN_EXTENSIONS.has(extname(entry.name))) out.push(join(dir, entry.name));
  }
  return out;
}

async function scan(root) {
  const findings = [];
  for (const sub of SCAN_ROOTS) {
    const dir = join(root, sub);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of await walk(dir, [])) {
      const rel = relative(root, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      const text = await readFile(file, "utf8");
      if (FORGERY_IMPORT.test(text)) {
        findings.push(`${rel}: imports \`encode\` from Auth.js's jwt module, which mints a session cookie`);
      } else if (NAMESPACE_IMPORT.test(text)) {
        findings.push(`${rel}: namespace-imports Auth.js's jwt module, which exposes \`encode\``);
      }
    }
  }
  return findings;
}

async function selftest() {
  const dir = await mkdtemp(join(tmpdir(), "no-session-forgery-"));
  let failures = 0;
  try {
    const cases = [
      ["named import", "src/x.ts", 'import { encode } from "next-auth/jwt";\n', true],
      ["core specifier", "src/y.ts", 'import { encode } from "@auth/core/jwt";\n', true],
      ["encode beside decode", "src/z.ts", 'import { decode, encode } from "next-auth/jwt";\n', true],
      ["namespace import", "e2e/n.ts", 'import * as jwt from "next-auth/jwt";\n', true],
      ["inside the auth config", "src/lib/auth.ts", 'import { encode } from "next-auth/jwt";\n', false],
      ["decode alone is fine", "src/d.ts", 'import { decode } from "next-auth/jwt";\n', false],
      ["another module's encode", "src/e.ts", 'import { encode } from "./codec";\n', false],
      ["the word in prose", "src/f.ts", "// we never encode a session here\n", false],
    ];
    for (const [name, rel, content, expectViolation] of cases) {
      const file = join(dir, rel);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, content, "utf8");
      const found = (await scan(dir)).some((f) => f.startsWith(rel));
      // Clear the file again so cases cannot leak into one another.
      await rm(file);
      if (found === expectViolation) {
        console.log(`  ok   ${name} ${expectViolation ? "fails" : "passes"}`);
      } else {
        console.error(`  FAIL ${name}: expected ${expectViolation ? "a finding" : "none"}`);
        failures += 1;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`SELFTEST ${failures === 0 ? "PASS" : "FAIL"}`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  if (process.argv.includes("--selftest")) {
    process.exit(await selftest());
  }
  const findings = await scan(DASHBOARD_ROOT);
  if (findings.length > 0) {
    console.error("check-no-session-forgery: FAIL");
    for (const f of findings) console.error(`  ${f}`);
    console.error(
      "\nMinting a session outside the auth configuration is a second way to be " +
        "authenticated. If a test needs a signed-in browser, sign in — see e2e/README.md.",
    );
    process.exit(1);
  }
  console.log("check-no-session-forgery: OK (nothing outside the auth config mints a session)");
}

await main();
