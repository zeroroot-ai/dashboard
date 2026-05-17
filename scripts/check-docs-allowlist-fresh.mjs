#!/usr/bin/env node
/**
 * check-docs-allowlist-fresh.mjs
 *
 * Build-time drift gate for `.docs-allowlist.json`. The main scanner
 * (`check-no-internal-tech-in-docs.mjs`) catches *new* violations as they
 * arrive; this companion enforces the opposite direction — when a
 * customer-facing file is rewritten and its allowlisted lines disappear,
 * the allowlist MUST be shrunk in the same PR. Otherwise the allowlist
 * accumulates dead entries and loses its monotonic-shrink discipline.
 *
 * Same shape as the existing `check-authz-registry-fresh.mjs`:
 *
 *   1. Re-run the scan over the same scope as the main scanner
 *      (content/docs MDX + landing/public TS/TSX with JS-comment stripping).
 *   2. Compute what `.docs-allowlist.json` would look like after `--shrink`.
 *   3. Byte-compare against the committed copy.
 *   4. Exit non-zero with a `--shrink` hint on any drift.
 *
 * SCAN_ROOTS, DENY_PATTERNS and the comment-stripping behaviour MUST stay
 * in lockstep with check-no-internal-tech-in-docs.mjs. The two scripts
 * duplicate the config so each stays self-contained; if you change one,
 * change the other.
 *
 * Wired into `pnpm prebuild` immediately after the main scanner.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_PATH = join(ROOT, ".docs-allowlist.json");
const SCAN_ROOTS = [
  { root: "content/docs", extensions: new Set([".mdx"]), stripJsComments: false },
  { root: "components/gibson/landing", extensions: new Set([".ts", ".tsx"]), stripJsComments: true },
  { root: "app/(public)", extensions: new Set([".ts", ".tsx", ".mdx"]), stripJsComments: true },
];
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", "dist", "build", ".turbo", "coverage", "__tests__",
]);

// Pattern list MUST stay in sync with check-no-internal-tech-in-docs.mjs.
const DENY_PATTERNS = [
  { name: "zitadel", re: /\bZitadel\b/g },
  { name: "openfga", re: /\bOpenFGA\b/g },
  { name: "fga-bare", re: /\bFGA\b/g },
  { name: "spiffe", re: /\bSPIFFE\b/g },
  { name: "spire", re: /\bSPIRE\b/g },
  { name: "envoy", re: /\bEnvoy\b/g },
  { name: "ext-authz", re: /\bext[-_]authz\b/g },
  { name: "jwt-authn", re: /\bjwt_authn\b/g },
  { name: "jwks", re: /\bJWKS\b/g },
  { name: "x-gibson-identity", re: /x-gibson-identity[-*\w]*/g },
  { name: "cgjwt", re: /\bcgjwt(?:\.[A-Za-z]+)?\b/g },
  { name: "langfuse", re: /\bLangfuse\b/g },
  { name: "neo4j", re: /\bNeo4j\b/gi },
  { name: "cnpg", re: /\bCNPG\b|\bCloudNativePG\b/g },
  { name: "argocd", re: /\bArgoCD\b|\bArgo CD\b/g },
  { name: "cert-manager", re: /\bcert-manager\b/g },
  { name: "eso", re: /\bESO\b|\bExternal Secrets Operator\b/g },
  { name: "opa", re: /\bOPA\b/g },
  { name: "gibson-hosted-vault", re: /Gibson-hosted Vault/g },
];

function walk(dir, extensions, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full, extensions, out); continue; }
    const dot = name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = name.slice(dot);
    if (extensions.has(ext)) out.push(full);
  }
  return out;
}

function relPath(abs) {
  return relative(ROOT, abs).split(sep).join("/");
}

// stripJsComments — same implementation as check-no-internal-tech-in-docs.mjs.
// Replaces // line comments and /* */ block comments with spaces (preserving
// line/column positions). String literals (single, double, template) and
// JSX text are preserved verbatim — that content renders to the customer
// and must still be scanned.
function stripJsComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && i + 1 < n && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c; i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; continue; }
        if (quote === "`" && src[i] === "$" && i + 1 < n && src[i + 1] === "{") {
          out += "${"; i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
          out += "}"; continue;
        }
        out += src[i]; i++;
      }
      if (i < n) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function scanFile(absPath, opts = {}) {
  const rel = relPath(absPath);
  let src;
  try { src = readFileSync(absPath, "utf8"); } catch { return []; }
  if (opts.stripJsComments) {
    src = stripJsComments(src);
  }
  const lines = src.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of DENY_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (m) violations.push({ file: rel, line: i + 1, pattern: name, match: m[0] });
    }
  }
  return violations;
}

function scanAll() {
  const violations = [];
  for (const cfg of SCAN_ROOTS) {
    const files = walk(join(ROOT, cfg.root), cfg.extensions);
    for (const f of files) {
      violations.push(...scanFile(f, { stripJsComments: cfg.stripJsComments }));
    }
  }
  return violations;
}

function violationKey(v) {
  return `${v.file}:${v.line}:${v.pattern}`;
}

function expectedAllowlistJson() {
  const violations = scanAll();
  const violationByKey = new Map(violations.map((v) => [violationKey(v), v]));
  const committed = existsSync(ALLOWLIST_PATH)
    ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
    : [];

  // What `--shrink` would write: every committed entry that is still backed
  // by a current scan hit, using the scan's current match string (so changes
  // to the matched substring force the entry to either stay current or
  // disappear cleanly).
  const kept = committed
    .filter((a) => violationByKey.has(violationKey(a)))
    .map((a) => {
      const v = violationByKey.get(violationKey(a));
      return { file: v.file, line: v.line, pattern: v.pattern, match: v.match };
    });

  const sorted = [...kept].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.pattern < b.pattern ? -1 : 1;
  });
  return JSON.stringify(sorted, null, 2) + "\n";
}

function committedJson() {
  if (!existsSync(ALLOWLIST_PATH)) {
    return JSON.stringify([], null, 2) + "\n";
  }
  return readFileSync(ALLOWLIST_PATH, "utf8");
}

const expected = expectedAllowlistJson();
const committed = committedJson();

if (expected === committed) {
  console.log("check-docs-allowlist-fresh.mjs: OK — .docs-allowlist.json is in sync with customer-facing scan.");
  process.exit(0);
}

process.stderr.write(
  "\n❌ .docs-allowlist.json has stale or out-of-order entries relative to the current content/docs/ scan.\n\n",
);
process.stderr.write(
  "Resolve by running:\n  node scripts/check-no-internal-tech-in-docs.mjs --shrink\n",
);
process.stderr.write(
  "Then commit the updated .docs-allowlist.json alongside the docs change that caused the drift.\n",
);
process.exit(1);
