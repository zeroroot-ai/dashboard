#!/usr/bin/env node
/**
 * Build guard: every EXPORTED mutating handler under `app/api/**` must call
 * `requireCsrf(request)`, or carry an explicit exemption with a reason.
 *
 * ## Why this exists
 *
 * `src/lib/auth/csrf.ts` states the rule plainly: "every mutating route
 * handler under `app/api/**` must call `requireCsrf(request)` before any state
 * change". The rule was written down and then not kept. At the time this guard
 * landed, 7 of 25 route files with a mutating export called it, and nothing in
 * `scripts/` looked for the other 18 — so the count could only drift further,
 * one PR at a time, with every check still green.
 *
 * The sweep that added the missing calls is the smaller half of the fix. This
 * file is the half that keeps them.
 *
 * ## Per-export, not per-file
 *
 * The check is on each exported handler separately, which is the shape a
 * regression actually takes: `app/api/settings/providers/[name]/route.ts`
 * exports PUT, PATCH and DELETE, and `app/api/onboarding/status/route.ts`
 * exports POST and DELETE. A file-level grep for `requireCsrf` is satisfied by
 * any one of them and says nothing about the rest.
 *
 * An export is satisfied when its own body, or the body of a same-file helper
 * it calls (resolved transitively, so a shared `guard(request)` still counts),
 * contains a call to `requireCsrf`.
 *
 * ## Exemptions
 *
 * File-level, in the top-of-file comment block:
 *   // @csrf-exempt: <reason>
 *
 * Per-export, in that export's own leading comment:
 *   // @csrf-exempt: <reason>
 *
 * The reason is mandatory and is checked for: a bare marker is itself a
 * violation. It exists to force a review-time conversation, because every
 * legitimate exemption here is legitimate for a specific, statable reason:
 * Auth.js validates its own token on its own routes; a top-level navigation
 * cannot attach a header and uses fetch metadata instead; a cross-origin
 * caller has no cookie on this origin to double-submit.
 *
 * ## Self-test
 *
 *   node scripts/check-api-route-csrf.mjs --selftest
 *
 * Builds throwaway fixtures and asserts the guard REJECTS every defect it
 * claims to catch and ACCEPTS compliant shapes. A guard that cannot fail is
 * worse than no guard; this repo has shipped inert ones before (dashboard#996),
 * which is why the meta-guard `check-guard-selftests.mjs` runs this.
 *
 * Exit codes: 0 clean, 1 violation.
 */

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const SCRIPT_NAME = "check-api-route-csrf";
const ROOT = resolve(new URL("..", import.meta.url).pathname);

/** Only route handlers. A page or a component cannot be POSTed to. */
const API_DIR = join("app", "api");

/** HTTP methods that change state. GET/HEAD/OPTIONS are out of scope. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

/** The gate. */
const CSRF_CALL = /\brequireCsrf\s*\(/;

/**
 * An exemption marker with a non-empty reason. `\S+` after the colon is the
 * part that makes a bare `// @csrf-exempt:` fail rather than pass.
 */
const EXEMPT_WITH_REASON = /@csrf-exempt:\s*\S+/;
/** Any marker at all, so a reason-less one can be reported as such. */
const EXEMPT_ANY = /@csrf-exempt:/;

/** How far to follow same-file helper calls when resolving the gate. */
const MAX_HELPER_DEPTH = 3;

function toPosix(p) {
  return p.split(sep).join("/");
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/^route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function parse(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function isExported(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Collect every function-ish declaration in the file by name, so a handler's
 * call to a same-file helper can be followed.
 */
function collectLocalFunctions(sf) {
  const byName = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      byName.set(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          byName.set(decl.name.text, decl.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return byName;
}

/** Names of functions called anywhere inside `node`. */
function calleeNames(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return names;
}

/**
 * True when `node`'s body, or a same-file helper it reaches within
 * MAX_HELPER_DEPTH hops, calls requireCsrf.
 */
function gated(node, locals, sf, depth = 0, seen = new Set()) {
  if (!node) return false;
  if (CSRF_CALL.test(node.getText(sf))) return true;
  if (depth >= MAX_HELPER_DEPTH) return false;
  for (const name of calleeNames(node)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const helper = locals.get(name);
    if (helper && gated(helper, locals, sf, depth + 1, seen)) return true;
  }
  return false;
}

/** The leading comment text attached to a declaration, if any. */
function leadingComment(node, text) {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges.map((r) => text.slice(r.pos, r.end)).join("\n");
}

/**
 * The top-of-file comment block: everything before the first statement. Used
 * for the file-level exemption so a route whose every handler is exempt for
 * one shared reason states it once.
 */
function fileHeader(sf, text) {
  const first = sf.statements[0];
  // `getStart(sf)` is the position AFTER leading trivia, so the slice is
  // exactly the comment block above the first statement. `getFullStart()`
  // would be 0 here and yield an empty header.
  return first ? text.slice(0, first.getStart(sf)) : text;
}

/**
 * Analyse one route file.
 * Returns { exports: [{ method, gated, exemptReasoned, exemptBare }] }.
 */
function analyse(text, fileName) {
  const sf = parse(text, fileName);
  const locals = collectLocalFunctions(sf);
  const header = fileHeader(sf, text);
  const fileExemptReasoned = EXEMPT_WITH_REASON.test(header);
  const fileExemptBare = !fileExemptReasoned && EXEMPT_ANY.test(header);

  const results = [];

  const consider = (name, fnNode, declNode) => {
    if (!MUTATING_METHODS.has(name)) return;
    const own = leadingComment(declNode, text);
    const ownExemptReasoned = EXEMPT_WITH_REASON.test(own);
    const ownExemptBare = !ownExemptReasoned && EXEMPT_ANY.test(own);
    results.push({
      method: name,
      gated: gated(fnNode, locals, sf),
      exemptReasoned: fileExemptReasoned || ownExemptReasoned,
      exemptBare: fileExemptBare || ownExemptBare,
    });
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isExported(stmt)) {
      consider(stmt.name.text, stmt, stmt);
    } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        // `export const POST = handler` where handler is a same-file function:
        // resolve it so the indirection does not hide the gate.
        let fnNode = decl.initializer;
        if (fnNode && ts.isIdentifier(fnNode)) fnNode = locals.get(fnNode.text) ?? fnNode;
        consider(decl.name.text, fnNode, stmt);
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      // `export { handler as POST }`
      for (const spec of stmt.exportClause.elements) {
        const exported = spec.name.text;
        const local = (spec.propertyName ?? spec.name).text;
        consider(exported, locals.get(local), stmt);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(rootDir = ROOT, { quiet = false } = {}) {
  const files = walk(join(rootDir, API_DIR));
  const violations = [];
  const bareMarkers = [];
  let exportCount = 0;
  let exemptCount = 0;

  for (const file of files) {
    const rel = toPosix(relative(rootDir, file));
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const r of analyse(text, file)) {
      exportCount += 1;
      if (r.exemptBare) {
        bareMarkers.push({ file: rel, method: r.method });
        continue;
      }
      if (r.gated) continue;
      if (r.exemptReasoned) {
        exemptCount += 1;
        continue;
      }
      violations.push({ file: rel, method: r.method });
    }
  }

  if (bareMarkers.length > 0) {
    if (!quiet) {
      console.error(
        `\n${SCRIPT_NAME}: ${bareMarkers.length} @csrf-exempt marker(s) with no reason:\n`,
      );
      for (const b of bareMarkers) console.error(`  - ${b.file} -> ${b.method}`);
      console.error("\nWrite `// @csrf-exempt: <why this handler is safe without it>`.\n");
    }
    return 1;
  }

  if (violations.length > 0) {
    if (!quiet) {
      console.error(
        `\n${SCRIPT_NAME}: ${violations.length} mutating route export(s) with no ` +
          `requireCsrf call and no @csrf-exempt marker:\n`,
      );
      for (const v of violations) console.error(`  - ${v.file} -> ${v.method}`);
      console.error(
        "\nAdd, at the top of EACH mutating handler:\n" +
          "  try {\n" +
          "    await requireCsrf(request);\n" +
          "  } catch (err) {\n" +
          "    if (err instanceof CsrfError) return csrfErrorResponse(err);\n" +
          "    throw err;\n" +
          "  }\n" +
          "or, only where a token genuinely cannot be carried, a\n" +
          "  // @csrf-exempt: <reason>\n" +
          "marker on that export (or at the top of the file for all of them).\n" +
          "Client callers must send the header: use apiFetch from " +
          "src/lib/api/fetch.ts rather than bare fetch.\n",
      );
    }
    return 1;
  }

  if (!quiet) {
    console.log(
      `${SCRIPT_NAME}: ok (${exportCount} mutating export(s) across ${files.length} ` +
        `route file(s); ${exemptCount} exempt with a stated reason)`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const GATED = `import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
export async function POST(request) {
  try { await requireCsrf(request); } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }
  return Response.json({ ok: true });
}
`;

function runSelfTest() {
  const base = join(tmpdir(), `${SCRIPT_NAME}-selftest-${process.pid}`);
  rmSync(base, { recursive: true, force: true });

  const cases = [
    {
      name: "gated POST passes",
      expectFail: false,
      files: { "app/api/x/route.ts": GATED },
    },
    {
      name: "ungated POST is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export async function POST() { return Response.json({}); }\n`,
      },
    },
    {
      name: "ungated PUT is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export async function PUT() { return Response.json({}); }\n`,
      },
    },
    {
      name: "ungated PATCH is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export async function PATCH() { return Response.json({}); }\n`,
      },
    },
    {
      name: "ungated DELETE is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export async function DELETE() { return Response.json({}); }\n`,
      },
    },
    {
      // THE property. A file-level grep passes this; the regression is exactly
      // this shape.
      name: "ungated DELETE beside a gated POST is caught (per-export, not per-file)",
      expectFail: true,
      files: {
        "app/api/x/route.ts": GATED + `export async function DELETE() { return Response.json({}); }\n`,
      },
    },
    {
      name: "ungated exported arrow handler is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export const POST = async () => Response.json({});\n`,
      },
    },
    {
      name: "ungated `export { handler as POST }` is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `async function handler() { return Response.json({}); }\nexport { handler as POST };\n`,
      },
    },
    {
      name: "GET-only route passes (no false positive)",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `export async function GET() { return Response.json({}); }\n`,
      },
    },
    {
      name: "gate via a same-file helper passes (no false positive)",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `import { requireCsrf } from '@/src/lib/auth/csrf';
async function guard(request) { await requireCsrf(request); }
export async function POST(request) { await guard(request); return Response.json({}); }
`,
      },
    },
    {
      name: "gate reached through two helper hops passes",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `import { requireCsrf } from '@/src/lib/auth/csrf';
async function inner(request) { await requireCsrf(request); }
async function outer(request) { await inner(request); }
export async function POST(request) { await outer(request); return Response.json({}); }
`,
      },
    },
    {
      name: "`export const POST = handler` resolves to the gated handler",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `import { requireCsrf } from '@/src/lib/auth/csrf';
async function handler(request) { await requireCsrf(request); return Response.json({}); }
export const POST = handler;
`,
      },
    },
    {
      name: "per-export exemption WITH a reason passes",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `// @csrf-exempt: Auth.js validates its own token on its own action routes
export async function POST() { return Response.json({}); }
`,
      },
    },
    {
      name: "file-level exemption WITH a reason passes",
      expectFail: false,
      files: {
        "app/api/x/route.ts": `/**
 * @csrf-exempt: cross-origin caller has no cookie on this origin to double-submit
 */
export async function POST() { return Response.json({}); }
export async function DELETE() { return Response.json({}); }
`,
      },
    },
    {
      // An exemption you can add without saying why is an exemption that gets
      // added without thinking why.
      name: "exemption with NO reason is caught",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `// @csrf-exempt:
export async function POST() { return Response.json({}); }
`,
      },
    },
    {
      name: "a comment merely mentioning requireCsrf does not gate the handler",
      expectFail: true,
      files: {
        "app/api/x/route.ts": `export async function POST() {
  return Response.json({});
}
// NOTE: should call requireCsrf(request) one day
`,
      },
    },
    {
      name: "a sibling gated handler does not gate an exempt-less one in another file",
      expectFail: true,
      files: {
        "app/api/a/route.ts": GATED,
        "app/api/b/route.ts": `export async function POST() { return Response.json({}); }\n`,
      },
    },
    {
      name: "nested route directories are searched",
      expectFail: true,
      files: {
        "app/api/deep/[id]/nested/route.ts": `export async function POST() { return Response.json({}); }\n`,
      },
    },
    {
      name: "route files under __tests__ are ignored",
      expectFail: false,
      files: {
        "app/api/x/__tests__/route.ts": `export async function POST() { return Response.json({}); }\n`,
      },
    },
  ];

  let failures = 0;
  for (const [i, c] of cases.entries()) {
    const dir = join(base, `case-${i}`);
    for (const [rel, contents] of Object.entries(c.files)) {
      const full = join(dir, rel);
      mkdirSync(resolve(full, ".."), { recursive: true });
      writeFileSync(full, contents, "utf8");
    }
    const code = run(dir, { quiet: true });
    const failed = code !== 0;
    const ok = failed === c.expectFail;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${c.name} ` +
        `(expected ${c.expectFail ? "rejection" : "acceptance"}, got ` +
        `${failed ? "rejection" : "acceptance"})`,
    );
  }

  rmSync(base, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n[${SCRIPT_NAME}] --selftest FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  console.log(`\n[${SCRIPT_NAME}] --selftest PASSED (${cases.length} cases).`);
}

if (process.argv.slice(2).includes("--selftest")) {
  runSelfTest();
} else {
  process.exit(run());
}
