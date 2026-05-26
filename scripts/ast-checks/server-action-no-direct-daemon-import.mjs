#!/usr/bin/env node
/**
 * AST walker: server-action-no-direct-daemon-import
 *
 * Asserts that no file under app/actions/ or any file marked with the
 * `"use server"` directive imports the generated daemon ConnectRPC
 * client (`@/gen/gibson/...`) directly. Daemon traffic MUST flow
 * through the canonical wrapper at src/lib/gibson-client.ts so SPIFFE +
 * Envoy + ext-authz handling happens in one place.
 *
 * This is the file-system / CI-time variant of the ESLint rule
 * `zeroroot-ai/no-direct-daemon-import`. The ESLint rule is editor-time
 * (PR-blocking via eslint); the walker is invoked by
 * `pnpm test:ast-checks` as a faster targeted scan and is friendly to
 * zda-ast-style retrieval.
 *
 * Slice 3.8 of the production-readiness epic (gibson#173 → board #16).
 *
 * Run: node scripts/ast-checks/server-action-no-direct-daemon-import.mjs
 * Test fixture mode: node scripts/ast-checks/server-action-no-direct-daemon-import.mjs --fixtures
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");

const DAEMON_IMPORT_RE = /^@\/gen\/gibson\//;
const ALLOWED_DIRECT = new Set([
  "src/lib/gibson-client.ts",
  // Generated TS may import other generated TS.
]);
const ALLOWED_PREFIXES = ["src/gen/"];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "coverage",
  ".worktrees",
  "playwright-report",
  "test-results",
  "scripts", // the walker's own fixtures
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

function fileIsServerAction(filePath, source) {
  const rel = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  if (rel.startsWith("app/actions/")) return true;
  // First statement is `"use server";` directive?
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const first = sf.statements[0];
  if (
    first &&
    first.kind === ts.SyntaxKind.ExpressionStatement &&
    first.expression.kind === ts.SyntaxKind.StringLiteral &&
    first.expression.text === "use server"
  ) {
    return true;
  }
  return false;
}

function fileImportsForbidden(filePath, source) {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  for (const stmt of sf.statements) {
    if (
      stmt.kind === ts.SyntaxKind.ImportDeclaration &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const spec = stmt.moduleSpecifier.text;
      if (DAEMON_IMPORT_RE.test(spec)) {
        findings.push({
          file: relative(REPO_ROOT, filePath),
          line: sf.getLineAndCharacterOfPosition(stmt.pos).line + 1,
          spec,
        });
      }
    }
  }
  return findings;
}

function isAllowed(filePath) {
  const rel = relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  if (ALLOWED_DIRECT.has(rel)) return true;
  if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) return true;
  return false;
}

async function runFixtures() {
  const fixturesDir = join(__dirname, "fixtures");
  let failures = 0;
  for (const kind of ["legal", "illegal"]) {
    const dir = join(fixturesDir, kind);
    if (
      !readdirSync(dir).some((n) => n.startsWith("server-action-"))
    ) {
      console.error(`fixture dir ${dir} missing server-action-* file`);
      failures++;
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("server-action-")) continue;
      const full = join(dir, name);
      const src = readFileSync(full, "utf8");
      const isServer = fileIsServerAction(full, src);
      const findings = isServer ? fileImportsForbidden(full, src) : [];
      const expectsFinding = kind === "illegal";
      const got = findings.length > 0;
      if (got !== expectsFinding) {
        console.error(
          `fixture ${kind}/${name} expected findings=${expectsFinding}, got=${got}`
        );
        failures++;
      } else {
        console.log(`fixture ${kind}/${name} ✓`);
      }
    }
  }
  if (failures > 0) {
    console.error(`fixture suite: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("all fixtures passed");
}

async function run() {
  const allFindings = [];
  for (const file of walk(REPO_ROOT)) {
    if (isAllowed(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!fileIsServerAction(file, src)) continue;
    allFindings.push(...fileImportsForbidden(file, src));
  }
  if (allFindings.length > 0) {
    console.error("server-action-no-direct-daemon-import: violations");
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}  imports ${f.spec}`);
    }
    console.error(
      "\nAll daemon traffic MUST flow through src/lib/gibson-client.ts (ConnectRPC wrapper)."
    );
    process.exit(1);
  }
  console.log("server-action-no-direct-daemon-import: ok");
}

if (process.argv.includes("--fixtures")) {
  await runFixtures();
} else {
  await run();
}
