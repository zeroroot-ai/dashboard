#!/usr/bin/env node
/**
 * Build guard: a CLIENT component must not make a mutating same-origin `/api`
 * request with bare `fetch`. It has to go through `apiFetch`
 * (src/lib/api/fetch.ts), which attaches the `x-csrf-token` header the route
 * side requires.
 *
 * ## Why this exists
 *
 * This is the client-side complement to `check-api-route-csrf.mjs`. That guard
 * makes every mutating route call `requireCsrf`; this one makes every client
 * caller send the token. Both halves are needed: a route that demands the
 * header and a caller that never sends it produces a connector page where the
 * catalog loads but every Enable/Disable/Authorize returns 403 — which is
 * exactly what shipped (dashboard#1121). The route guard was green the whole
 * time, because the omission was on the client. Nothing looked for it.
 *
 * ## What is a violation
 *
 * In a file whose first statement is the `"use client"` directive: a call to
 * `fetch` (or `window.fetch` / `globalThis.fetch`) whose
 *   - first argument is a string or template literal beginning `/api/`, and
 *   - second argument is an object literal with `method:` set to a
 *     POST / PUT / PATCH / DELETE string literal (case-insensitive).
 * A GET (or omitted method), an external URL, or a call through `apiFetch` is
 * fine. Server code is out of scope: it has no `document.cookie` to read and
 * legitimately fetches external services.
 *
 * ## Exemptions
 *
 * A reason is mandatory, so the exemption forces a review-time conversation.
 *   - File-level, in the top-of-file comment block:  // @apifetch-exempt: <reason>
 *   - Per-call, on the call's line or the line above:  // @apifetch-exempt: <reason>
 * A bare marker with no reason is itself a violation.
 *
 * ## Self-test
 *
 *   node scripts/check-client-mutation-uses-apifetch.mjs --selftest
 *
 * Builds throwaway fixtures and asserts the guard REJECTS every defect it
 * claims to catch and ACCEPTS compliant shapes. A guard that cannot fail is
 * worse than no guard (dashboard#996), which is why the meta-guard
 * `check-guard-selftests.mjs` runs this.
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

const SCRIPT_NAME = "check-client-mutation-uses-apifetch";
const ROOT = resolve(new URL("..", import.meta.url).pathname);

/** HTTP methods that change state, and so require the CSRF header. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "coverage",
  ".worktrees",
  ".claude",
  "playwright-report",
  "test-results",
  "__tests__",
  "scripts",
]);

const EXEMPT_WITH_REASON = /@apifetch-exempt:[ \t]*\S/;
const EXEMPT_ANY = /@apifetch-exempt:/;

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
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function parse(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** True when the file's first statement is the `"use client"` directive. */
function isClientComponent(sf) {
  const first = sf.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

/** The static leading text of a string/template argument, or null. */
function literalStringStart(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
}

/** The `method:` value as an uppercase literal, or null if absent/dynamic. */
function methodLiteral(objLit) {
  for (const prop of objLit.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ((ts.isIdentifier(prop.name) && prop.name.text === "method") ||
        (ts.isStringLiteral(prop.name) && prop.name.text === "method"))
    ) {
      const init = prop.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        return init.text.toUpperCase();
      }
      return null; // present but dynamic; cannot prove a mutation statically
    }
  }
  return null;
}

/** Is `node` a call to fetch / window.fetch / globalThis.fetch (not apiFetch)? */
function isBareFetchCallee(callee) {
  if (ts.isIdentifier(callee)) return callee.text === "fetch";
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "fetch" &&
    ts.isIdentifier(callee.expression)
  ) {
    return callee.expression.text === "window" || callee.expression.text === "globalThis";
  }
  return false;
}

/** Violations in one client-component source: [{ line, method, bare }]. */
function findViolations(sf, text) {
  const lines = text.split("\n");
  const header = sf.statements[0] ? text.slice(0, sf.statements[0].getStart(sf)) : text;
  const fileExemptReasoned = EXEMPT_WITH_REASON.test(header);
  const fileExemptBare = !fileExemptReasoned && EXEMPT_ANY.test(header);

  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && isBareFetchCallee(node.expression)) {
      const [arg0, arg1] = node.arguments;
      const path = arg0 ? literalStringStart(arg0) : null;
      if (path && path.startsWith("/api/") && arg1 && ts.isObjectLiteralExpression(arg1)) {
        const method = methodLiteral(arg1);
        if (method && MUTATING_METHODS.has(method)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          // Per-call exemption: the call's line or a short comment block (up to
          // 4 lines) directly above it, so a multi-line reason is honored.
          const near = lines.slice(Math.max(0, line - 5), line).join("\n");
          const callExemptReasoned = EXEMPT_WITH_REASON.test(near);
          const callExemptBare = !callExemptReasoned && EXEMPT_ANY.test(near);
          if (fileExemptReasoned || callExemptReasoned) {
            // exempt with a stated reason
          } else if (fileExemptBare || callExemptBare) {
            out.push({ line, method, bare: true });
          } else {
            out.push({ line, method, bare: false });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

function run(rootDir = ROOT, { quiet = false } = {}) {
  const files = walk(rootDir);
  const violations = [];
  const bareMarkers = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/["']use client["']/.test(text)) continue; // cheap pre-filter
    const sf = parse(text, file);
    if (!isClientComponent(sf)) continue;
    const rel = toPosix(relative(rootDir, file));
    for (const v of findViolations(sf, text)) {
      (v.bare ? bareMarkers : violations).push({ file: rel, line: v.line, method: v.method });
    }
  }

  if (bareMarkers.length > 0) {
    if (!quiet) {
      console.error(`\n${SCRIPT_NAME}: ${bareMarkers.length} @apifetch-exempt marker(s) with no reason:\n`);
      for (const b of bareMarkers) console.error(`  - ${b.file}:${b.line}  ${b.method}`);
      console.error("\nWrite `// @apifetch-exempt: <why this bare fetch is safe>`.\n");
    }
    return 1;
  }

  if (violations.length > 0) {
    if (!quiet) {
      console.error(
        `\n${SCRIPT_NAME}: ${violations.length} client-side mutating fetch(es) to /api that ` +
          `skip apiFetch (no CSRF header):\n`,
      );
      for (const v of violations) console.error(`  - ${v.file}:${v.line}  ${v.method}`);
      console.error(
        "\nUse apiFetch from src/lib/api/fetch.ts instead of bare fetch for mutating\n" +
          "requests to /api routes; it attaches the x-csrf-token header requireCsrf\n" +
          "demands. Or, where a call genuinely must not, add a\n" +
          "  // @apifetch-exempt: <reason>\n" +
          "on that call (or the top of the file).\n",
      );
    }
    return 1;
  }

  if (!quiet) {
    console.log(`${SCRIPT_NAME}: ok (${files.length} file(s) scanned)`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const CLIENT = '"use client";\n';

function runSelfTest() {
  const base = mkdtempSync(join(tmpdir(), `${SCRIPT_NAME}-selftest-`));

  const cases = [
    {
      name: "bare fetch POST to /api is caught",
      expectFail: true,
      files: {
        "components/X.tsx": CLIENT + `await fetch("/api/x", { method: "POST", body: "{}" });\n`,
      },
    },
    { name: "bare fetch PUT to /api is caught", expectFail: true, files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: "PUT" });\n` } },
    { name: "bare fetch PATCH to /api is caught", expectFail: true, files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: "PATCH" });\n` } },
    { name: "bare fetch DELETE to /api is caught", expectFail: true, files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: "DELETE" });\n` } },
    {
      name: "template-literal /api path is caught",
      expectFail: true,
      files: { "components/X.tsx": CLIENT + "fetch(`/api/x/${id}/authorize`, { method: \"POST\" });\n" },
    },
    {
      name: "lowercase method is caught",
      expectFail: true,
      files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: "post" });\n` },
    },
    {
      name: "window.fetch mutation is caught",
      expectFail: true,
      files: { "components/X.tsx": CLIENT + `window.fetch("/api/x", { method: "DELETE" });\n` },
    },
    {
      name: "apiFetch mutation passes",
      expectFail: false,
      files: {
        "components/X.tsx": CLIENT + `import { apiFetch } from "@/src/lib/api/fetch";\napiFetch("/api/x", { method: "POST" });\n`,
      },
    },
    { name: "GET to /api passes", expectFail: false, files: { "components/X.tsx": CLIENT + `fetch("/api/x");\n` } },
    {
      name: "explicit GET method to /api passes",
      expectFail: false,
      files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: "GET" });\n` },
    },
    {
      name: "mutation to an external URL passes",
      expectFail: false,
      files: { "components/X.tsx": CLIENT + `fetch("https://vendor.example/token", { method: "POST" });\n` },
    },
    {
      name: "same bare fetch in a NON-client file is out of scope (passes)",
      expectFail: false,
      files: { "app/api/x/route.ts": `export async function POST() { await fetch("/api/y", { method: "POST" }); }\n` },
    },
    {
      name: "per-call exemption WITH a reason passes",
      expectFail: false,
      files: {
        "components/X.tsx": CLIENT + `// @apifetch-exempt: top-level navigation cannot carry a header\nfetch("/api/x", { method: "POST" });\n`,
      },
    },
    {
      name: "multi-line per-call exemption block WITH a reason passes",
      expectFail: false,
      files: {
        "components/X.tsx": CLIENT + `// @apifetch-exempt: unauthenticated guest flow with no session to protect,
// errors are swallowed for enumeration protection
await fetch("/api/x", { method: "POST" });
`,
      },
    },
    {
      name: "file-level exemption WITH a reason passes",
      expectFail: false,
      files: {
        "components/X.tsx": `"use client";\n// @apifetch-exempt: this file talks only to a cross-origin service\nfetch("/api/x", { method: "POST" });\n`,
      },
    },
    {
      name: "exemption with NO reason is caught",
      expectFail: true,
      files: {
        "components/X.tsx": CLIENT + `// @apifetch-exempt:\nfetch("/api/x", { method: "POST" });\n`,
      },
    },
    {
      name: "dynamic method (variable) is not flagged (cannot prove a mutation)",
      expectFail: false,
      files: { "components/X.tsx": CLIENT + `fetch("/api/x", { method: m });\n` },
    },
    {
      name: "nested directories are searched",
      expectFail: true,
      files: { "components/deep/nested/X.tsx": CLIENT + `fetch("/api/x", { method: "POST" });\n` },
    },
    {
      name: "files under __tests__ are ignored",
      expectFail: false,
      files: { "components/__tests__/X.test.tsx": CLIENT + `fetch("/api/x", { method: "POST" });\n` },
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
        `(expected ${c.expectFail ? "rejection" : "acceptance"}, got ${failed ? "rejection" : "acceptance"})`,
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
