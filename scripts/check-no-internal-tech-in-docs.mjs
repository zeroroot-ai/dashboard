#!/usr/bin/env node
/**
 * check-no-internal-tech-in-docs.mjs
 *
 * Build-time guard enforcing the customer-doc terminology invariant from
 * zeroroot-ai/dashboard#124. Customer-facing surfaces (MDX docs AND public
 * marketing components) name product capabilities (Gibson identity service,
 * Gibson permissions, Gibson Traces, Gibson-managed secrets storage), NOT
 * the vendors implementing them.
 *
 * Scanned surfaces:
 *   - content/docs/**\/*.mdx                  (rendered customer docs)
 *   - components/gibson/landing/**\/*.{ts,tsx}  (marketing components)
 *   - app/(public)/**\/*.{ts,tsx,mdx}          (public routes — pricing, signup, login)
 *
 * For .ts/.tsx files, JS comments (// line + block) are stripped before
 * scanning. Engineering docstrings exempt; string literals + JSX text
 * are still scanned (those render to the customer).
 *
 * Canonical reference for the deny-list + replacement vocabulary:
 * https://github.com/zeroroot-ai/docs/blob/main/repos/dashboard/customer-doc-terminology.md
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
 *   --selftest   Synthesises temp fixtures (one .mdx, one .tsx) containing the
 *                full deny-list, asserts the scanner catches each pattern in
 *                both file kinds and ignores patterns inside JS comments.
 *                Exit 0 iff every pattern was caught and no false positive
 *                surfaced from comments.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST_PATH = join(ROOT, ".docs-allowlist.json");

// Each scan root declares its own extension allowlist and whether JS-style
// comments should be stripped before pattern matching. The rule of thumb:
// scan whatever renders to a customer. For .ts/.tsx, that means JSX text +
// string literals — engineering docstrings (// or /* */) are exempt.
const SCAN_ROOTS = [
  { root: "content/docs", extensions: new Set([".mdx"]), stripJsComments: false },
  { root: "components/gibson/landing", extensions: new Set([".ts", ".tsx"]), stripJsComments: true },
  { root: "app/(public)", extensions: new Set([".ts", ".tsx", ".mdx"]), stripJsComments: true },
];

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

function walk(dir, extensions, out = []) {
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
      walk(full, extensions, out);
      continue;
    }
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

// stripJsComments replaces the contents of // line comments and /* */ block
// comments with spaces (preserving line/column positions so violation line
// numbers stay accurate). String literals (single, double, template) are
// preserved verbatim — those render to the customer and must still be scanned.
// JSX text-content is preserved verbatim too: outside string literals, a `//`
// that is NOT followed by a `*` and is NOT inside a regex literal is treated
// as a comment. Inside JSX text, '//' as content is uncommon enough that we
// accept the false-negative risk in exchange for a small, dependency-free
// implementation. Comments inside string literals are preserved (correct).
function stripJsComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    // Line comment
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    // Block comment
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && i + 1 < n && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    // String literals — preserve verbatim, including any // or /* inside.
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        // Template-string `${ … }` interpolation: walk the expression with
        // brace-counting so a `//` inside it is still treated as code.
        if (quote === "`" && src[i] === "$" && i + 1 < n && src[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
          out += "}";
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < n) {
        out += src[i]; // closing quote
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function scanFile(absPath, opts = {}) {
  const rel = relPath(absPath);
  let src;
  try {
    src = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  if (opts.stripJsComments) {
    src = stripJsComments(src);
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
  // The deny-list fixture body — one mention per pattern class so the scanner
  // is required to catch each. Shared by the .mdx and .tsx fixtures.
  const denyMentions = [
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
  ];

  // Fixture 1: an .mdx file under content/docs — exercises the raw-scan path
  // (no comment stripping). All deny-list patterns must be caught.
  const mdxDir = join(ROOT, "content", "docs", "__selftest_dir");
  const mdxPath = join(mdxDir, "__selftest.mdx");
  mkdirSync(mdxDir, { recursive: true });
  const mdxBody = ["---", "title: selftest", "---", "", ...denyMentions].join("\n");
  writeFileSync(mdxPath, mdxBody);

  // Fixture 2: a .tsx file under components/gibson/landing — exercises the
  // comment-aware scan path. The deny-list patterns live in JSX text + string
  // literals (which must be caught); the same patterns in // line and /* */
  // block comments must be IGNORED.
  const tsxDir = join(ROOT, "components", "gibson", "landing", "__selftest_dir");
  const tsxPath = join(tsxDir, "__selftest.tsx");
  mkdirSync(tsxDir, { recursive: true });
  // Build a TSX module that:
  //  - includes the full deny list in an exported string array (visible).
  //  - repeats the full deny list inside a block comment (must be ignored).
  //  - repeats the full deny list inside line comments (must be ignored).
  const visibleArray =
    "export const visible: string[] = [\n" +
    denyMentions.map((s) => `  "${s.replace(/"/g, '\\"')}",`).join("\n") +
    "\n];\n";
  const blockComment =
    "/*\n" + denyMentions.map((s) => " * " + s).join("\n") + "\n */\n";
  const lineComments =
    denyMentions.map((s) => `// ${s}`).join("\n") + "\n";
  const tsxBody = lineComments + blockComment + visibleArray;
  writeFileSync(tsxPath, tsxBody);

  try {
    const want = new Set(DENY_PATTERNS.map((d) => d.name));

    // .mdx scan: scan as-is. Must catch every pattern at least once.
    const mdxViolations = scanFile(mdxPath, { stripJsComments: false });
    const mdxPatterns = new Set(mdxViolations.map((v) => v.pattern));
    const mdxMissing = [...want].filter((p) => !mdxPatterns.has(p));
    if (mdxMissing.length > 0) {
      process.stderr.write(
        `❌ --selftest FAILED (.mdx fixture): scanner missed pattern(s): ${mdxMissing.join(", ")}\n`,
      );
      return 1;
    }

    // .tsx scan WITH comment stripping. Each pattern must register at least
    // once (from the visible array). Patterns with multiple OR alternatives
    // (e.g. /ArgoCD|Argo CD/, /ext-authz|ext_authz/, /ESO|External Secrets Operator/)
    // legitimately match more than once because all spellings appear in the
    // array. The real comment-stripping invariant is the next check (raw vs
    // stripped ratio).
    const tsxViolations = scanFile(tsxPath, { stripJsComments: true });
    const tsxPatterns = new Set(tsxViolations.map((v) => v.pattern));
    const tsxMissing = [...want].filter((p) => !tsxPatterns.has(p));
    if (tsxMissing.length > 0) {
      process.stderr.write(
        `❌ --selftest FAILED (.tsx visible-text fixture): scanner missed pattern(s) in string literals: ${tsxMissing.join(", ")}\n`,
      );
      return 1;
    }
    const tsxCounts = new Map();
    for (const v of tsxViolations) {
      tsxCounts.set(v.pattern, (tsxCounts.get(v.pattern) ?? 0) + 1);
    }

    // .tsx scan WITHOUT comment stripping (regression check). The fixture
    // duplicates the deny list in 3 locations: line comments, block comments,
    // visible array. With comment stripping ON we keep only the array, so
    // every pattern's raw count must be exactly 3× its stripped count. Any
    // other ratio means the comment stripper either leaked (raw > 3× stripped)
    // or over-ate (raw < 3× stripped — would chew through string literals).
    const tsxRawViolations = scanFile(tsxPath, { stripJsComments: false });
    const tsxRawCounts = new Map();
    for (const v of tsxRawViolations) {
      tsxRawCounts.set(v.pattern, (tsxRawCounts.get(v.pattern) ?? 0) + 1);
    }
    const ratioWrong = [];
    for (const p of want) {
      const raw = tsxRawCounts.get(p) ?? 0;
      const stripped = tsxCounts.get(p) ?? 0;
      if (raw !== stripped * 3) {
        ratioWrong.push(`${p} (raw=${raw}, stripped=${stripped}; expected raw == 3 * stripped)`);
      }
    }
    if (ratioWrong.length > 0) {
      process.stderr.write(
        `❌ --selftest FAILED (.tsx comment-stripping ratio): ${ratioWrong.join("; ")}\n` +
          `   the fixture has each deny-list mention in 3 places (line comment, block ` +
          `comment, visible array). After stripping comments the raw count must drop by 2/3.\n`,
      );
      return 1;
    }

    console.log(
      `check-no-internal-tech-in-docs.mjs --selftest: OK ` +
        `(.mdx: caught all ${want.size}; .tsx visible: caught all ${want.size}; ` +
        `comment stripping: raw = 3 × stripped for every pattern).`,
    );
    return 0;
  } finally {
    try {
      rmSync(mdxDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    try {
      rmSync(tsxDir, { recursive: true, force: true });
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
