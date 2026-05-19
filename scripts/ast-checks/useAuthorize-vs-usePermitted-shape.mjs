#!/usr/bin/env node
/**
 * AST walker: useAuthorize-vs-usePermitted-shape
 *
 * Asserts the hook split (see dashboard CLAUDE.md "Frontend authz"):
 *
 *   - `usePermitted("perm:string")`  — synchronous; reads server-hydrated
 *     membership state. ALWAYS imported from `@/src/lib/auth/tenant`.
 *
 *   - `useAuthorize("rpcMethod")`    — asynchronous; React Query against
 *     `/api/auth/my-memberships`. ALWAYS imported from
 *     `@/lib/auth/use-authorize` AND must be inside a component that
 *     handles the `loading` field returned by the hook (hide-on-loading).
 *
 * Mixing them up corrupts the visibility contract: usePermitted on a
 * loading-only-knowable RPC silently flips false; useAuthorize without
 * a loading guard flashes unauthorized content. This walker catches
 * the most common mistakes statically.
 *
 * Slice 3.8 of the production-readiness epic (gibson#173 → board #16).
 *
 * Run: node scripts/ast-checks/useAuthorize-vs-usePermitted-shape.mjs
 * Fixtures: node scripts/ast-checks/useAuthorize-vs-usePermitted-shape.mjs --fixtures
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "coverage",
  ".worktrees",
  "playwright-report",
  "test-results",
  "scripts", // exclude the walker's own fixtures from the real scan
]);

const USE_PERMITTED_IMPORT_RE =
  /^@\/(src\/)?lib\/auth\/tenant$|^@\/lib\/auth\/tenant$/;
const USE_AUTHORIZE_IMPORT_RE =
  /^@\/(src\/)?lib\/auth\/use-authorize$|^@\/lib\/auth\/use-authorize$/;

// Allowlist (ratchet): files exempt from the hook-shape contract.
// Ratchets ONLY shrink. New entries require a linked issue + reviewer
// nod. Each entry is the workspace-relative path.
const ALLOWLIST = new Set([
  // The canonical hook's own colocated test file uses the colocated
  // relative import + tests internal states; it doesn't need the
  // hide-on-loading guard because that's the contract being tested.
  "src/lib/auth/__tests__/use-authorize.test.tsx",
  // Components that pre-date the walker. Drain tracked at the follow-up
  // issue created by slice 3.8's PR body.
  "src/components/mission/CheckpointTimeline.tsx",
  "src/components/secrets/SecretDetail.tsx",
  "src/components/secrets/SecretsList.tsx",
  "src/components/secrets-backend/SecretsBackendForm.tsx",
  "src/components/gibson/settings/PluginDetailContent.tsx",
  "app/dashboard/(auth)/missions/[id]/page.tsx",
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

function analyse(filePath, source) {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // Imports we care about (and complain if mis-sourced).
  const importedFrom = new Map(); // hookName -> import-specifier string
  for (const stmt of sf.statements) {
    if (
      stmt.kind === ts.SyntaxKind.ImportDeclaration &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause &&
      stmt.importClause.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      const spec = stmt.moduleSpecifier.text;
      for (const el of stmt.importClause.namedBindings.elements) {
        if (
          el.name.text === "usePermitted" ||
          el.name.text === "useAuthorize"
        ) {
          importedFrom.set(el.name.text, spec);
        }
      }
    }
  }

  const findings = [];

  function getLine(node) {
    return sf.getLineAndCharacterOfPosition(node.pos).line + 1;
  }

  // Bad-import findings
  if (importedFrom.has("usePermitted")) {
    const src = importedFrom.get("usePermitted");
    if (!USE_PERMITTED_IMPORT_RE.test(src)) {
      findings.push({
        file: relative(REPO_ROOT, filePath),
        line: 1,
        msg: `usePermitted imported from non-canonical path "${src}" (expected @/lib/auth/tenant or @/src/lib/auth/tenant)`,
      });
    }
  }
  if (importedFrom.has("useAuthorize")) {
    const src = importedFrom.get("useAuthorize");
    if (!USE_AUTHORIZE_IMPORT_RE.test(src)) {
      findings.push({
        file: relative(REPO_ROOT, filePath),
        line: 1,
        msg: `useAuthorize imported from non-canonical path "${src}" (expected @/lib/auth/use-authorize or @/src/lib/auth/use-authorize)`,
      });
    }
  }

  // useAuthorize call must destructure `loading` (and `allowed`).
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useAuthorize"
    ) {
      // Walk up to the VariableDeclaration to inspect destructuring.
      let p = node.parent;
      while (p && !ts.isVariableDeclaration(p)) p = p.parent;
      if (!p || !ts.isVariableDeclaration(p)) {
        findings.push({
          file: relative(REPO_ROOT, filePath),
          line: getLine(node),
          msg: "useAuthorize() return value not bound to a destructuring pattern; cannot enforce loading-guard contract",
        });
      } else if (!ts.isObjectBindingPattern(p.name)) {
        findings.push({
          file: relative(REPO_ROOT, filePath),
          line: getLine(node),
          msg: "useAuthorize() result must be destructured as { allowed, loading }; got non-object binding",
        });
      } else {
        const bound = new Set();
        for (const el of p.name.elements) {
          if (ts.isIdentifier(el.name)) bound.add(el.name.text);
          else if (ts.isObjectBindingPattern(el.name)) {
            // unsupported nested binding — flag
          }
        }
        if (!bound.has("loading")) {
          findings.push({
            file: relative(REPO_ROOT, filePath),
            line: getLine(node),
            msg: "useAuthorize() result must destructure `loading` to enforce hide-on-loading contract (see CLAUDE.md \"Frontend authz\")",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return findings;
}

async function runFixtures() {
  const fixturesDir = join(__dirname, "fixtures");
  let failures = 0;
  for (const kind of ["legal", "illegal"]) {
    const dir = join(fixturesDir, kind);
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("hooks-")) continue;
      const full = join(dir, name);
      const src = readFileSync(full, "utf8");
      const findings = analyse(full, src);
      const expects = kind === "illegal";
      const got = findings.length > 0;
      if (got !== expects) {
        console.error(
          `fixture ${kind}/${name} expected findings=${expects}, got=${got} :: ${JSON.stringify(findings)}`
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
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    // Quick prefilter: only files mentioning either hook
    if (
      !src.includes("useAuthorize") &&
      !src.includes("usePermitted")
    ) {
      continue;
    }
    allFindings.push(...analyse(file, src));
  }
  if (allFindings.length > 0) {
    console.error("useAuthorize-vs-usePermitted-shape: violations");
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}  ${f.msg}`);
    }
    process.exit(1);
  }
  console.log("useAuthorize-vs-usePermitted-shape: ok");
}

if (process.argv.includes("--fixtures")) {
  await runFixtures();
} else {
  await run();
}
