#!/usr/bin/env node
/**
 * check-no-internal-tech-in-docs.mjs
 *
 * Build-time guard enforcing the customer-doc terminology invariant from
 * zero-day-ai/dashboard#124. Customer-facing docs at `content/docs/**\/*.mdx`
 * name product capabilities (Gibson identity service, Gibson permissions,
 * Gibson Traces, Gibson-managed secrets storage), NOT the vendors implementing
 * them.
 *
 * Canonical reference for the deny-list + replacement vocabulary:
 * https://github.com/zero-day-ai/docs/blob/main/repos/dashboard/customer-doc-terminology.md
 *
 * Out of scope:
 *   - `enterprise/platform/dashboard/docs/**\/*.md`  (internal developer docs)
 *   - every `CLAUDE.md`                              (intentionally architectural)
 *
 * Existing violations are captured in `.docs-allowlist.json` at the repo
 * root, monotonic-shrink only — the same discipline as
 * `.color-allowlist.json`:
 *
 *   - New violation (not in allowlist) → FAIL.
 *   - Allowlist entry whose source line no longer matches → FAIL with a hint
 *     to run `--shrink` and commit the result.
 *
 * Modes:
 *
 *   (default)    Scan; compare to allowlist; fail on drift in either direction.
 *   --shrink     Regenerate `.docs-allowlist.json` by removing entries that no
 *                longer match in source. Never adds new entries.
 *   --seed       One-shot: regenerate `.docs-allowlist.json` from the current
 *                scan. Use ONCE at land time to bootstrap the list; CI should
 *                reject this mode going forward.
 *   --selftest   Synthesises a temp .mdx file containing one fixture per
 *                deny-list pattern class, asserts the scanner catches each,
 *                cleans up. Exit 0 iff every pattern was caught.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_PATH = join(ROOT, ".docs-allowlist.json");

// Only customer-facing docs are in scope.
const SCAN_ROOTS = ["content/docs"];

const SCAN_EXTENSIONS = new Set([".mdx"]);

const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", "dist", "build", ".turbo", "coverage", "__tests__",
]);

// Each pattern names what to write instead. The `suggest` field is printed when
// the scanner fails so the error doubles as a how-to. Patterns are
// case-sensitive on purpose — these are proper nouns / technical identifiers,
// and lowercase variants (e.g. "envoyé") would otherwise trip false positives.
const DENY_PATTERNS = [
  {
    name: "zitadel",
    re: /\bZitadel\b/g,
    suggest: '"Gibson identity service" or drop',
  },
  {
    name: "openfga",
    re: /\bOpenFGA\b/g,
    suggest: '"Gibson permissions" / "grants"',
  },
  {
    name: "fga-bare",
    re: /\bFGA\b/g,
    suggest: '"Gibson permissions" / "grants" / "grant"',
  },
  {
    name: "spiffe",
    re: /\bSPIFFE\b/g,
    suggest: 'drop, or generic "workload identity"',
  },
  {
    name: "spire",
    re: /\bSPIRE\b/g,
    suggest: 'drop',
  },
  {
    name: "envoy",
    re: /\bEnvoy\b/g,
    suggest: 'drop — customer never sees the edge proxy',
  },
  {
    name: "ext-authz",
    re: /\bext[-_]authz\b/g,
    suggest: 'drop — internal authorization-decision boundary',
  },
  {
    name: "jwt-authn",
    re: /\bjwt_authn\b/g,
    suggest: 'drop — internal Envoy filter',
  },
  {
    name: "jwks",
    re: /\bJWKS\b/g,
    suggest: 'drop — internal validator surface',
  },
  {
    name: "x-gibson-identity",
    re: /x-gibson-identity[-*\w]*/g,
    suggest: 'drop — internal wire-header detail',
  },
  {
    name: "cgjwt",
    re: /\bcgjwt(?:\.[A-Za-z]+)?\b/g,
    suggest: 'drop — internal verifier package',
  },
  {
    name: "langfuse",
    re: /\bLangfuse\b/g,
    suggest: '"Gibson Traces" / "the trace explorer" / "tenant trace view"',
  },
  {
    name: "neo4j",
    re: /\bNeo4j\b/gi,
    suggest: 'drop — customer never sees the knowledge-graph backend',
  },
  {
    name: "cnpg",
    re: /\bCNPG\b|\bCloudNativePG\b/g,
    suggest: 'drop — customer never sees the Postgres operator',
  },
  {
    name: "argocd",
    re: /\bArgoCD\b|\bArgo CD\b/g,
    suggest: 'drop — customer never sees the GitOps controller',
  },
  {
    name: "cert-manager",
    re: /\bcert-manager\b/g,
    suggest: 'drop — internal TLS material lifecycle',
  },
  {
    name: "eso",
    re: /\bESO\b|\bExternal Secrets Operator\b/g,
    suggest: 'drop — internal secret-syncing controller',
  },
  {
    name: "opa",
    re: /\bOPA\b/g,
    suggest: 'drop — internal policy-evaluation engine',
  },
  {
    name: "gibson-hosted-vault",
    re: /Gibson-hosted Vault/g,
    suggest: '"Gibson-managed secrets storage" — drop the implementation detail',
  },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = name.slice(dot);
    if (SCAN_EXTENSIONS.has(ext)) out.push(full);
  }
  return out;
}

function relPath(abs) {
  return relative(ROOT, abs).split(sep).join("/");
}

export function scanFile(absPath) {
  const rel = relPath(absPath);
  let src;
  try {
    src = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const lines = src.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of DENY_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        violations.push({
          file: rel,
          line: i + 1,
          pattern: name,
          match: m[0],
          text: line.trim(),
        });
      }
    }
  }
  return violations;
}

function scanAll() {
  const files = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root)));
  return files.flatMap(scanFile);
}

function violationKey(v) {
  return `${v.file}:${v.line}:${v.pattern}`;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(`❌ failed to parse ${ALLOWLIST_PATH}: ${err.message}\n`);
    process.exit(1);
  }
}

function writeAllowlist(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.pattern < b.pattern ? -1 : 1;
  });
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function suggestFor(patternName) {
  const p = DENY_PATTERNS.find((d) => d.name === patternName);
  return p ? p.suggest : "";
}

function runScan() {
  const violations = scanAll();
  const allowlist = loadAllowlist();

  const violationByKey = new Map(violations.map((v) => [violationKey(v), v]));
  const allowByKey = new Map(allowlist.map((a) => [violationKey(a), a]));

  const fresh = [];
  const stale = [];
  const moved = [];

  for (const [k, v] of violationByKey) {
    if (!allowByKey.has(k)) fresh.push(v);
  }
  for (const [k, a] of allowByKey) {
    if (!violationByKey.has(k)) stale.push(a);
    else {
      const v = violationByKey.get(k);
      if (a.match !== v.match) moved.push({ allow: a, found: v });
    }
  }

  const problems = fresh.length + stale.length + moved.length;
  if (problems === 0) {
    console.log(
      `check-no-internal-tech-in-docs.mjs: clean (${violations.length} known violation(s) in .docs-allowlist.json)`,
    );
    return 0;
  }

  if (fresh.length > 0) {
    process.stderr.write(
      `\n❌ ${fresh.length} new internal-tech mention(s) in customer docs.\n` +
        `Customer docs name product capabilities, not vendors. See docs.git → ` +
        `repos/dashboard/customer-doc-terminology.md.\n\n`,
    );
    for (const v of fresh) {
      process.stderr.write(`  ${v.file}:${v.line} [${v.pattern}]  ${v.match}\n`);
      process.stderr.write(`    write instead: ${suggestFor(v.pattern)}\n`);
      process.stderr.write(`    line: ${v.text}\n\n`);
    }
  }
  if (stale.length > 0) {
    process.stderr.write(
      `\n❌ ${stale.length} stale .docs-allowlist.json entry/entries — source line no longer matches:\n\n`,
    );
    for (const a of stale) {
      process.stderr.write(`  ${a.file}:${a.line} [${a.pattern}]  was: ${a.match}\n`);
    }
    process.stderr.write(
      "\nFix: run `node scripts/check-no-internal-tech-in-docs.mjs --shrink` and commit " +
        "the updated allowlist.\n",
    );
  }
  if (moved.length > 0) {
    process.stderr.write(
      `\n❌ ${moved.length} allowlist entry/entries match a different forbidden term than recorded:\n\n`,
    );
    for (const { allow, found } of moved) {
      process.stderr.write(
        `  ${allow.file}:${allow.line} [${allow.pattern}]  allowlisted: ${allow.match}, found: ${found.match}\n`,
      );
    }
    process.stderr.write(
      "\nFix: the line changed at an allowlisted slot but still contains a forbidden term. " +
        "Replace with the customer-side term, or run `--shrink` if the new value is intentional.\n",
    );
  }
  return 1;
}

function runShrink() {
  const violations = scanAll();
  const allowlist = loadAllowlist();
  const violationByKey = new Map(violations.map((v) => [violationKey(v), v]));

  const before = allowlist.length;
  const kept = allowlist
    .filter((a) => violationByKey.has(violationKey(a)))
    .map((a) => {
      const v = violationByKey.get(violationKey(a));
      return { file: v.file, line: v.line, pattern: v.pattern, match: v.match };
    });
  writeAllowlist(kept);
  console.log(
    `check-no-internal-tech-in-docs.mjs --shrink: allowlist ${before} → ${kept.length} entries.`,
  );
  return 0;
}

function runSeed() {
  const violations = scanAll();
  const seeded = violations.map((v) => ({
    file: v.file,
    line: v.line,
    pattern: v.pattern,
    match: v.match,
  }));
  writeAllowlist(seeded);
  console.log(
    `check-no-internal-tech-in-docs.mjs --seed: wrote ${seeded.length} entries to .docs-allowlist.json.`,
  );
  return 0;
}

function runSelftest() {
  // One fixture per pattern class. The .mdx file is written into a temp dir
  // *under* one of the SCAN_ROOTS so the walker picks it up.
  const fixtureDir = join(ROOT, "content", "docs", "__selftest_dir");
  const fixturePath = join(fixtureDir, "__selftest.mdx");
  mkdirSync(fixtureDir, { recursive: true });
  const body = [
    "---",
    "title: selftest",
    "---",
    "",
    "Signed in via Zitadel.",
    "OpenFGA holds the tuples.",
    "FGA decision.",
    "SPIFFE identity.",
    "SPIRE agent.",
    "Envoy chain.",
    "ext-authz adds headers.",
    "ext_authz alt spelling.",
    "jwt_authn filter.",
    "JWKS endpoint.",
    "x-gibson-identity-subject header.",
    "cgjwt.Verifier here.",
    "Langfuse traces.",
    "Neo4j store.",
    "CNPG postgres.",
    "ArgoCD app.",
    "Argo CD spelling.",
    "cert-manager Certificate.",
    "ESO syncs secrets.",
    "External Secrets Operator pulls.",
    "OPA policies.",
    "Gibson-hosted Vault for default backend.",
  ].join("\n");
  writeFileSync(fixturePath, body);
  try {
    const violations = scanFile(fixturePath);
    const patterns = new Set(violations.map((v) => v.pattern));
    const want = new Set(DENY_PATTERNS.map((d) => d.name));
    const missing = [...want].filter((p) => !patterns.has(p));
    if (missing.length > 0) {
      process.stderr.write(
        `❌ --selftest FAILED: scanner missed pattern(s): ${missing.join(", ")}\n`,
      );
      return 1;
    }
    console.log(
      `check-no-internal-tech-in-docs.mjs --selftest: OK (caught all ${want.size} pattern classes).`,
    );
    return 0;
  } finally {
    try {
      rmSync(fixtureDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

const mode = process.argv[2];
let code;
switch (mode) {
  case "--seed":
    code = runSeed();
    break;
  case "--shrink":
    code = runShrink();
    break;
  case "--selftest":
    code = runSelftest();
    break;
  default:
    code = runScan();
}
process.exit(code);
