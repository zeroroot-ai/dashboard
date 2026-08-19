#!/usr/bin/env node
/**
 * Build guard: every EXPORTED Server Action must perform a server-side
 * authorization check, or carry an explicit exemption with a reason.
 *
 * ## What went wrong before
 *
 * The previous revision was weak in two independent ways:
 *
 *   1. It searched only `app/actions` and `src/components`. Server actions
 *      also live in `app/(public)/`, `app/dashboard/`, `app/(authenticated)/`
 *      and top-level `components/`, and every action in those trees was
 *      simply never looked at.
 *   2. It was FILE-level, not per-export. One `assertAuthorized(` anywhere in
 *      a file satisfied the gate for every other export in that file, so
 *      adding a second, ungated action next to a gated one was a clean pass.
 *      That is the shape a regression actually takes.
 *
 * ## What this checks now
 *
 * Every `"use server"` file anywhere under `app/`, `src/` or `components/` is
 * parsed with the TypeScript compiler API, and EACH exported function is
 * checked on its own. An export is satisfied when its body (plus the bodies of
 * same-file helpers it calls, resolved transitively so a shared
 * `requireAdmin()` still counts) contains one of:
 *
 *   - `userClient(...)`            the user-acting daemon transport, which
 *                                  bakes a fail-closed assertAuthorized into
 *                                  every dispatch (dashboard#848 / #902)
 *   - a call to a binding imported from a user-acting gibson-client wrapper
 *     module, those dispatch exclusively through userClient
 *   - `assertAuthorized(...)`      manual registry gating
 *   - `requireCrdSession(...)` / `requireCrdSessionForSelfAction(...)`
 *   - `getServerSession()` / `getActiveTenant()` / `await auth()`, the
 *     minimum floor: the action resolves server-side identity at all
 *
 * NOTE the barrel import `@/src/lib/gibson-client` is deliberately NOT
 * recognized: it also re-exports serviceClient (service-acting, NOT
 * authz-gated), so importing the barrel proves nothing.
 *
 * `app/actions/crd/**` is excluded, it has a stricter per-action gate in
 * check-crd-action-authz.mjs.
 *
 * ## Exemptions
 *
 * File-level (applies to every export in the file), in the top-of-file block:
 *   // @server-action-authz-exempt: <reason>
 *
 * Per-export, in that export's own leading comment:
 *   // @server-action-authz-exempt: <reason>
 *
 * A reason is mandatory, it exists to force a review-time conversation.
 * Reserve exemptions for genuinely pre-auth or non-sensitive actions (signup
 * runs before a session exists; theme is a cosmetic preference).
 *
 * ## Self-test
 *
 *   node scripts/check-server-action-authz.mjs --selftest
 *
 * Exit codes: 0 clean, 1 violation.
 */

import {
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const SCRIPT_NAME = "check-server-action-authz";
const ROOT = resolve(new URL("..", import.meta.url).pathname);

/**
 * Roots searched for `"use server"` files. Deliberately broad: an action is
 * defined by its directive, not by which folder someone put it in.
 */
const SEARCH_DIRS = ["app", "src", "components"];

/** crd/ is covered by the stricter check-crd-action-authz.mjs. */
const EXCLUDE_PREFIXES = [join("app", "actions", "crd")];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "__tests__",
  "gen",
  "generated",
]);

const AUTHZ_PATTERNS = [
  /\buserClient\s*[<(]/,
  /\bassertAuthorized\s*\(/,
  /\brequireCrdSession(ForSelfAction)?\s*[<(]/,
  // setActiveTenant resolves the caller's FGA memberships and refuses a tenant
  // the caller is not a member of before it writes the scope cookie
  // (src/lib/auth/active-tenant.ts). An action that delegates to it has done a
  // real server-side membership check.
  /\bsetActiveTenant\s*\(/,
];

/**
 * Pre-existing exports audited as genuinely non-sensitive, kept here rather
 * than as in-file markers so this guard could be widened without editing
 * action files owned by other work in flight. Same intent as
 * `.permitted-nodeenv.json` for check-no-nodeenv-conditioned-auth.
 *
 * A stale entry (one that no longer matches a real violation) is itself an
 * error, so this list cannot quietly accumulate.
 *
 * Converting these to in-file `// @server-action-authz-exempt:` markers is a
 * trivial follow-up for the owners of those files.
 */
const PRE_EXISTING_EXEMPT = [
  {
    file: "app/dashboard/(auth)/actions.ts",
    export: "logAuthBoundaryError",
    reason:
      "writes a structured log line from an opaque client-supplied error digest; " +
      "reads nothing and returns nothing",
  },
  {
    file: "app/actions/missions/create-mission.ts",
    export: "getTemplateCUESourceAction",
    reason:
      "returns a vendored static template file selected from a hardcoded id " +
      "allowlist; identical for every caller and carries no tenant data",
  },
];

const SESSION_PATTERNS = [
  /\bgetServerSession\s*\(/,
  /\bgetActiveTenant\s*\(/,
  /\bawait\s+auth\s*\(/,
];

/** Modules whose exports dispatch exclusively through userClient. */
const WRAPPER_MODULE =
  /^@\/src\/lib\/gibson-client\/(secrets|mission-source|plugins-admin|tenant-broker-config|grants|logs)$/;

const EXEMPT = /@server-action-authz-exempt:\s*\S+/;
const USE_SERVER = /^\s*["']use server["']/m;

/** How far to follow same-file helper calls when resolving a gate. */
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
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Leading comment text immediately above a node. */
function leadingComment(sourceText, node) {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  return ranges.map((r) => sourceText.slice(r.pos, r.end)).join("\n");
}

function isExported(node) {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (mods ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Collect, from one source file:
 *   - `exports`: each exported function-shaped declaration
 *   - `helpers`: same-file function bodies, by name, for call resolution
 *   - `wrapperBindings`: identifiers imported from user-acting wrapper modules
 */
function collectFile(sourceText, fileName) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const exportsFound = [];
  const helpers = new Map();
  const wrapperBindings = new Set();

  const record = (name, node, exported, comment) => {
    const text = node.getText(sf);
    if (name) helpers.set(name, text);
    if (exported) exportsFound.push({ name: name ?? "<anonymous>", text, comment });
  };

  for (const stmt of sf.statements) {
    // import { a, b } from "<wrapper module>"
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (WRAPPER_MODULE.test(stmt.moduleSpecifier.text)) {
        const bindings = stmt.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) wrapperBindings.add(el.name.text);
        }
        if (stmt.importClause?.name) wrapperBindings.add(stmt.importClause.name.text);
      }
      continue;
    }

    if (ts.isFunctionDeclaration(stmt)) {
      record(
        stmt.name?.text,
        stmt,
        isExported(stmt),
        leadingComment(sourceText, stmt),
      );
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const exported = isExported(stmt);
      const comment = leadingComment(sourceText, stmt);
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer) continue;
        const isFn =
          ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer);
        const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
        if (!isFn) {
          // A re-exported reference (`export const POST = GET`) still needs a
          // gate, resolve it through the helper map by keeping its text.
          if (exported && name) exportsFound.push({ name, text: decl.getText(sf), comment });
          continue;
        }
        record(name, decl, exported, comment);
      }
    }
  }

  return { exportsFound, helpers, wrapperBindings };
}

/**
 * Expand `text` with the bodies of same-file helpers it references, so an
 * action gated by a shared local `requireAdmin()` is not a false positive.
 */
function withHelpers(text, helpers, depth = 0, seen = new Set()) {
  if (depth >= MAX_HELPER_DEPTH) return text;
  let expanded = text;
  for (const [name, body] of helpers) {
    if (seen.has(name)) continue;
    if (!new RegExp(`\\b${name}\\s*[(<]`).test(text)) continue;
    seen.add(name);
    expanded += "\n" + withHelpers(body, helpers, depth + 1, seen);
  }
  return expanded;
}

function isGated(text, wrapperBindings) {
  if (AUTHZ_PATTERNS.some((re) => re.test(text))) return true;
  if (SESSION_PATTERNS.some((re) => re.test(text))) return true;
  for (const binding of wrapperBindings) {
    if (new RegExp(`\\b${binding}\\s*\\(`).test(text)) return true;
  }
  return false;
}

/**
 * Scan a repo root, returning per-export violations.
 *
 * `applyPreExisting` is on only for the real repo; the self-test drives this
 * function over fixtures and must see the raw verdict.
 */
function runScan(root, { applyPreExisting = false } = {}) {
  const violations = [];
  let fileCount = 0;
  let exportCount = 0;

  for (const dir of SEARCH_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file);
      if (EXCLUDE_PREFIXES.some((p) => rel === p || rel.startsWith(p + sep))) continue;

      const src = readFileSync(file, "utf8");
      if (!USE_SERVER.test(src)) continue;
      fileCount += 1;

      const { exportsFound, helpers, wrapperBindings } = collectFile(src, file);

      // File-level exemption: the marker must appear before the first export.
      const firstExportMatch = /^\s*export\b/m.exec(src);
      const fileHeader = src.slice(0, firstExportMatch ? firstExportMatch.index : src.length);
      const fileExempt = EXEMPT.test(fileHeader);

      for (const exp of exportsFound) {
        exportCount += 1;
        if (fileExempt) continue;
        if (EXEMPT.test(exp.comment)) continue;

        const expanded = withHelpers(exp.text, helpers);
        if (!isGated(expanded, wrapperBindings)) {
          violations.push({ file: toPosix(rel), export: exp.name });
        }
      }
    }
  }

  if (!applyPreExisting) {
    return { violations, fileCount, exportCount, staleExemptions: [] };
  }

  const kept = [];
  const used = new Set();
  for (const v of violations) {
    const match = PRE_EXISTING_EXEMPT.find(
      (e) => e.file === v.file && e.export === v.export,
    );
    if (match) {
      used.add(`${match.file}::${match.export}`);
      continue;
    }
    kept.push(v);
  }

  const staleExemptions = PRE_EXISTING_EXEMPT.filter(
    (e) => !used.has(`${e.file}::${e.export}`),
  );

  return { violations: kept, fileCount, exportCount, staleExemptions };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function writeFixture(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

const GATED = `"use server";
import { assertAuthorized } from "@/src/lib/auth/assert-authorized";
export async function safeAction() {
  await assertAuthorized("read", "thing");
  return 1;
}
`;

function runSelfTest() {
  // mkdtempSync, not a fixed /tmp path: it creates the directory atomically
  // with mode 0700 and an unpredictable suffix, so no other local user can
  // pre-plant a symlink at the fixture path or read the fixtures we write.
  const base = mkdtempSync(join(tmpdir(), `${SCRIPT_NAME}-selftest-`));

  const cases = [
    {
      name: "gated export passes",
      expectFail: false,
      files: { "app/actions/a.ts": GATED },
    },
    {
      name: "getServerSession floor passes",
      expectFail: false,
      files: {
        "app/actions/a.ts": `"use server";
import { getServerSession } from "@/src/lib/auth/session";
export async function a() { const s = await getServerSession(); return s; }
`,
      },
    },
    {
      name: "ungated export is caught",
      expectFail: true,
      files: {
        "app/actions/a.ts": `"use server";
export async function leaky() { return fetch("http://daemon/x"); }
`,
      },
    },
    {
      name: "SECOND ungated export beside a gated one is caught (per-export, was file-level)",
      expectFail: true,
      files: {
        "app/actions/a.ts":
          GATED +
          `
export async function leaky() { return fetch("http://daemon/x"); }
`,
      },
    },
    {
      name: "ungated export under app/(public)/ is caught (widened paths)",
      expectFail: true,
      files: {
        "app/(public)/select-tenant/actions.ts": `"use server";
export async function leaky() { return 1; }
`,
      },
    },
    {
      name: "ungated export under app/dashboard/ is caught (widened paths)",
      expectFail: true,
      files: {
        "app/dashboard/(auth)/actions.ts": `"use server";
export async function leaky() { return 1; }
`,
      },
    },
    {
      name: "ungated export under app/(authenticated)/ is caught (widened paths)",
      expectFail: true,
      files: {
        "app/(authenticated)/_actions/quota.ts": `"use server";
export async function leaky() { return 1; }
`,
      },
    },
    {
      name: "ungated export under top-level components/ is caught (widened paths)",
      expectFail: true,
      files: {
        "components/gibson/shared/tenant-switcher-action.ts": `"use server";
export async function leaky() { return 1; }
`,
      },
    },
    {
      name: "ungated exported arrow function is caught",
      expectFail: true,
      files: {
        "app/actions/a.ts": `"use server";
export const leaky = async () => { return 1; };
`,
      },
    },
    {
      name: "gate via a same-file helper passes (no false positive)",
      expectFail: false,
      files: {
        "app/actions/a.ts": `"use server";
import { assertAuthorized } from "@/src/lib/auth/assert-authorized";
async function requireAdmin() { await assertAuthorized("admin", "tenant"); }
export async function a() { await requireAdmin(); return 1; }
`,
      },
    },
    {
      name: "gate via a user-acting wrapper import passes",
      expectFail: false,
      files: {
        "app/actions/a.ts": `"use server";
import { listSecrets } from "@/src/lib/gibson-client/secrets";
export async function a() { return listSecrets(); }
`,
      },
    },
    {
      name: "barrel import alone does NOT satisfy the gate",
      expectFail: true,
      files: {
        "app/actions/a.ts": `"use server";
import { serviceClient } from "@/src/lib/gibson-client";
export async function a() { return serviceClient(); }
`,
      },
    },
    {
      name: "per-export exemption marker passes",
      expectFail: false,
      files: {
        "app/actions/a.ts": `"use server";
// @server-action-authz-exempt: signup runs before a session exists
export async function a() { return 1; }
`,
      },
    },
    {
      name: "file-level exemption marker passes",
      expectFail: false,
      files: {
        "app/actions/a.ts": `"use server";
/* @server-action-authz-exempt: cosmetic preference only */
export async function a() { return 1; }
export async function b() { return 2; }
`,
      },
    },
    {
      name: "app/actions/crd is left to the stricter guard",
      expectFail: false,
      files: {
        "app/actions/crd/x.ts": `"use server";
export async function leaky() { return 1; }
`,
      },
    },
    {
      name: "file without a \"use server\" directive is out of scope",
      expectFail: false,
      files: { "app/actions/a.ts": `export async function notAnAction() { return 1; }\n` },
    },
  ];

  let failures = 0;
  for (const [i, testCase] of cases.entries()) {
    const dir = join(base, `case-${i}`);
    mkdirSync(dir, { recursive: true });
    writeFixture(dir, testCase.files);

    const { violations } = runScan(dir);
    const didFail = violations.length > 0;

    if (didFail === testCase.expectFail) {
      console.log(
        `  PASS  ${testCase.name}` +
          (didFail ? ` (guard reported: ${violations.map((v) => v.export).join(", ")})` : ""),
      );
    } else {
      failures += 1;
      console.error(
        `  FAIL  ${testCase.name}: expected the guard to ` +
          `${testCase.expectFail ? "REJECT" : "ACCEPT"} but it ` +
          `${didFail ? "rejected" : "accepted"}.`,
      );
      for (const v of violations) console.error(`        ${v.file} -> ${v.export}`);
    }
  }

  rmSync(base, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n[${SCRIPT_NAME}] --selftest FAILED (${failures} case(s)).`);
    process.exit(1);
  }
  console.log(`\n[${SCRIPT_NAME}] --selftest PASSED (${cases.length} cases).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (process.argv.slice(2).includes("--selftest")) {
  runSelfTest();
} else {
  const { violations, fileCount, exportCount, staleExemptions } = runScan(ROOT, {
    applyPreExisting: true,
  });

  if (staleExemptions.length > 0) {
    console.error(
      `\n${SCRIPT_NAME}: ${staleExemptions.length} stale PRE_EXISTING_EXEMPT ` +
        `entr${staleExemptions.length === 1 ? "y" : "ies"}, the export is now gated ` +
        `(or gone). Delete the entry:\n`,
    );
    for (const e of staleExemptions) console.error(`  - ${e.file} -> ${e.export}()`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(
      `\n${SCRIPT_NAME}: ${violations.length} exported server action(s) with no ` +
        `recognized server-side authz check and no @server-action-authz-exempt marker:\n`,
    );
    for (const v of violations) console.error(`  - ${v.file} -> ${v.export}()`);
    console.error(
      "\nAdd assertAuthorized(...), requireCrdSession(...), or " +
        "getServerSession()+hasPermission(...) to EACH exported action, or, only " +
        "for genuinely pre-auth/non-sensitive actions, a\n" +
        "  // @server-action-authz-exempt: <reason>\n" +
        "marker on that export (or at the top of the file for all of them).\n",
    );
    process.exit(1);
  }

  console.log(
    `${SCRIPT_NAME}: ok (${exportCount} exported action(s) across ${fileCount} "use server" file(s))`,
  );
}
