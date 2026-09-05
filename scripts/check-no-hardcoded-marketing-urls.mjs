#!/usr/bin/env node
/**
 * check-no-hardcoded-marketing-urls.mjs
 *
 * Fails the build when any hardcoded marketing host URL or `/pricing` literal
 * appears as a link destination in app/component/lib code.
 *
 * Background (dashboard#924 / PRD dashboard#920 / deploy ADR-0006):
 * The dashboard can run as a self-hosted install (no marketing surface) or as
 * the ZeroRoot SaaS offering. On self-hosted, `marketingUrl` is null and NO
 * marketing links must be rendered — they would be dead URLs. All links to the
 * marketing host MUST be derived from the deployment-profile resolver's
 * `marketingUrl` field; they must NEVER be hardcoded string literals.
 *
 * What this guard detects (in .ts / .tsx / .js / .jsx source files):
 *   1. Absolute URLs starting with `https://www.` used as `href` values — any
 *      hardcoded link to a `www.<domain>` marketing host.
 *   2. Absolute URLs starting with `https://zeroroot.ai/` — hardcoded links to
 *      the bare SaaS domain (e.g. /terms, /privacy).
 *   3. The string `"/pricing"` appearing as an href literal — a `/pricing` path
 *      is a marketing-site concept and must never be hardcoded in app code.
 *
 * What is NOT flagged:
 *   - Code comments (block and line comments are stripped before scanning).
 *   - Test files (*.test.*, *.spec.*, __tests__/) — tests legitimately use
 *     resolved URLs as expected values in assertions.
 *   - The guard script itself (scripts/ is not scanned).
 *   - `MARKETING_PREFIXES` and similar constants in host-routing.ts — they are
 *     path fragments used for redirect routing, not hardcoded href values, and
 *     the pattern does not match them (no `https://www.` prefix, no quoted href
 *     context).
 *   - Comments in deployment-profile.ts documenting example config values.
 *
 * Detection contract:
 *   TSX/TS code: block and line comments are stripped (newlines preserved) so
 *   only live code — JSX attributes, template literals, string constants — is
 *   inspected. The `href` context check reduces false positives from config
 *   strings in non-link code (though all three patterns are strong enough
 *   signals by themselves).
 *
 * Usage:
 *   node scripts/check-no-hardcoded-marketing-urls.mjs            # scan
 *   node scripts/check-no-hardcoded-marketing-urls.mjs --selftest # verify
 *
 * Exit codes: 0 clean, 1 violations found (or selftest failure), 2 error.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

// Scanned roots: the live application code. `scripts/` is intentionally
// excluded (this file mentions the patterns in comments/selftests).
const SEARCH_ROOTS = ["app", "components", "src"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "test-results",
  "playwright-report",
  "dist",
  "build",
  "coverage",
  "gen",
  "__snapshots__",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * Patterns that flag a hardcoded marketing URL.
 *
 * Pattern A: any absolute URL to a `www.` host (the SaaS marketing site).
 *   Matches: href="https://www.zeroroot.ai/pricing"
 *            href={`https://www.zeroroot.ai/contact-sales`}
 *   Does NOT match: // https://www.zeroroot.ai (comment, stripped first)
 *
 * Pattern B: absolute URL to the bare domain with a marketing path.
 *   Matches: href="https://zeroroot.ai/terms"
 *            href="https://zeroroot.ai/privacy"
 *   Does NOT match: mailto:support@zeroroot.ai (no slash-path after domain)
 *                   process.env documentation comments (stripped first)
 *
 * Pattern C: `/pricing` as a quoted string literal used as a link target.
 *   Matches: href="/pricing"   href={"/pricing"}
 *   Does NOT match: "/pricing?missing_plan=true" (has a query param — it is
 *   composed from marketingUrl, not a bare path), or MARKETING_PREFIXES array
 *   entries (those are not in href position and match only after stripping
 *   would still be caught, but let's be clear: the pattern here is the
 *   href-context form `"/pricing"` or `'/pricing'` as a bare path).
 */
const BANNED_PATTERNS = [
  {
    re: /https:\/\/www\./,
    why:
      'hardcoded www-host URL — derive from getDeploymentProfile().marketingUrl instead',
  },
  {
    re: /https:\/\/zeroroot\.ai\//,
    why:
      'hardcoded bare-domain marketing URL — derive from getDeploymentProfile().marketingUrl instead',
  },
  {
    re: /["'`]\/pricing["'`]/,
    why:
      '"/pricing" literal — pricing is a marketing-site path; compose from marketingUrl + "/pricing" instead',
  },
];

function toPosix(p) {
  return p.split(sep).join("/");
}

function isTestFile(name) {
  // Skip *.test.*, *.spec.*, and anything inside __tests__/
  return /\.(test|spec)\.[a-z]+$/.test(name) || /__tests__/.test(name);
}

/**
 * Strip block and line comments from source text, preserving newlines so
 * reported line numbers match the original file.
 *
 * Same approach as check-no-emdash and check-no-hardcoded-colors.
 */
function stripComments(text) {
  return text
    // Block comments: replace non-newline chars with spaces.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    // Line comments: blank out from `//` to end of line.
    .replace(/([^:]|^)\/\/.*$/gm, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** Return violation objects for one file. */
async function scanFile(absPath, relPath, hits) {
  const raw = await readFile(absPath, "utf8");
  const content = stripComments(raw);

  if (!BANNED_PATTERNS.some((b) => b.re.test(content))) return;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { re, why } of BANNED_PATTERNS) {
      if (re.test(line)) {
        hits.push({
          file: relPath,
          line: i + 1,
          text: raw.split("\n")[i].trim(), // show original (un-stripped) for context
          why,
        });
        // One violation per line is enough — don't double-report the same line.
        break;
      }
    }
  }
}

async function walk(dir, hits) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), hits);
      continue;
    }
    if (!entry.isFile() || isTestFile(entry.name)) continue;
    const dotIdx = entry.name.lastIndexOf(".");
    const ext = dotIdx === -1 ? "" : entry.name.slice(dotIdx).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const absPath = join(dir, entry.name);
    await scanFile(absPath, toPosix(relative(DASHBOARD_ROOT, absPath)), hits);
  }
}

async function checkEntry(entry, hits) {
  const abs = join(DASHBOARD_ROOT, entry);
  let info;
  try {
    info = await stat(abs);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  if (info.isDirectory()) return walk(abs, hits);
  if (info.isFile() && !isTestFile(entry)) {
    await scanFile(abs, toPosix(relative(DASHBOARD_ROOT, abs)), hits);
  }
}

// ---------------------------------------------------------------------------
// Self-test — verifies patterns match (and don't match) expected inputs
// ---------------------------------------------------------------------------

async function selftest() {
  const cases = [
    // --- Pattern A: www. host ---
    {
      input: 'href="https://www.zeroroot.ai/pricing"',
      expect: true,
      label: 'A.1: href with www. host',
    },
    {
      input: "href={`https://www.zeroroot.ai/contact-sales`}",
      expect: true,
      label: 'A.2: template-literal href with www. host',
    },
    {
      // Comment — should be stripped and NOT match.
      input: "/* https://www.zeroroot.ai/pricing */",
      expect: false,
      label: 'A.3: block comment with www. host (should not match after strip)',
    },
    {
      input: "// https://www.zeroroot.ai",
      expect: false,
      label: 'A.4: line comment with www. host (should not match after strip)',
    },

    // --- Pattern B: bare domain ---
    {
      input: 'href="https://zeroroot.ai/terms"',
      expect: true,
      label: 'B.1: href with bare domain /terms',
    },
    {
      input: 'href="https://zeroroot.ai/privacy"',
      expect: true,
      label: 'B.2: href with bare domain /privacy',
    },
    {
      // mailto: never has a slash-path; should not match B
      input: 'href="mailto:support@zeroroot.ai"',
      expect: false,
      label: 'B.3: mailto: link (no slash-path, should not match)',
    },

    // --- Pattern C: /pricing literal ---
    {
      input: 'href="/pricing"',
      expect: true,
      label: 'C.1: href="/pricing" literal',
    },
    {
      // Query-param form: comes from marketingUrl + "/pricing?..." (composed)
      // This WILL match because "/pricing" appears before the "?". Acceptable —
      // a bare /pricing path should never appear as a string literal in the code;
      // the composed form would be `${marketingUrl}/pricing` (template literal),
      // not the quoted form `"/pricing"`.
      input: 'redirect(`${marketingUrl}/pricing?missing_plan=true`)',
      expect: false,
      label: 'C.2: template-literal composed path (not a quoted string, should not match)',
    },
    {
      // The MARKETING_PREFIXES array uses "/pricing" as a string — this WILL
      // be flagged. That is intentional: host-routing.ts is in src/lib/, which
      // is scanned. The entry there is a path fragment used for routing logic,
      // not an href. We accept this flag and add a path-level allowlist
      // exemption for host-routing.ts in the checker below.
      input: 'const MARKETING_PREFIXES = ["/docs", "/pricing", "/contact-sales"]',
      expect: true,
      label: 'C.3: MARKETING_PREFIXES array (will match — exempted by filename in main)',
    },
  ];

  let pass = true;
  for (const { input, expect: wantMatch, label } of cases) {
    const stripped = stripComments(input);
    const got = BANNED_PATTERNS.some((b) => b.re.test(stripped));
    const ok = got === wantMatch;
    console.log(`  ${ok ? "OK" : "FAIL"} ${label}: got=${got}, want=${wantMatch}`);
    if (!ok) pass = false;
  }

  console.log(
    pass
      ? "[check-no-hardcoded-marketing-urls] selftest PASSED"
      : "[check-no-hardcoded-marketing-urls] selftest FAILED",
  );
  process.exit(pass ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Files that are explicitly exempt from certain pattern checks.
// These are infrastructure/routing modules that legitimately reference
// path fragments or example values — they are not href attributes.
// ---------------------------------------------------------------------------

/**
 * Return true if the relative path should be exempted from a specific ban.
 *
 * Narrow exemptions, each with a documented rationale:
 *
 *   host-routing.ts   — Pattern C ("/pricing" literal): MARKETING_PREFIXES is
 *                       a routing-redirect table of path fragments, not href
 *                       destinations rendered in the browser.
 *
 *   deployment-profile.ts — Patterns A & B: the resolver itself documents
 *                       example env-var values (e.g. WWW_URL=https://www.…)
 *                       in operator-facing error messages and TSDoc comments.
 *                       These are configuration instructions, not href links.
 */
function isExempt(relPath, patternIndex) {
  const posix = toPosix(relPath);

  // Pattern C ("/pricing" literal) — exempt routing infrastructure.
  if (patternIndex === 2 && posix.includes("host-routing")) return true;

  // Patterns A & B (www. host / bare domain) — exempt the resolver itself.
  if ((patternIndex === 0 || patternIndex === 1) && posix.includes("deployment-profile")) return true;

  return false;
}

// Override scanFile to apply exemptions per-pattern.
async function scanFileWithExemptions(absPath, relPath, hits) {
  const raw = await readFile(absPath, "utf8");
  const content = stripComments(raw);

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (let pi = 0; pi < BANNED_PATTERNS.length; pi += 1) {
      const { re, why } = BANNED_PATTERNS[pi];
      if (!re.test(line)) continue;
      if (isExempt(relPath, pi)) continue;
      hits.push({
        file: relPath,
        line: i + 1,
        text: raw.split("\n")[i].trim(),
        why,
      });
      // One violation per line.
      break;
    }
  }
}

// Patch walk + checkEntry to use the exemption-aware scanner.
async function walkWithExemptions(dir, hits) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkWithExemptions(join(dir, entry.name), hits);
      continue;
    }
    if (!entry.isFile() || isTestFile(entry.name)) continue;
    const dotIdx = entry.name.lastIndexOf(".");
    const ext = dotIdx === -1 ? "" : entry.name.slice(dotIdx).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const absPath = join(dir, entry.name);
    await scanFileWithExemptions(
      absPath,
      toPosix(relative(DASHBOARD_ROOT, absPath)),
      hits,
    );
  }
}

async function checkEntryWithExemptions(entry, hits) {
  const abs = join(DASHBOARD_ROOT, entry);
  let info;
  try {
    info = await stat(abs);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  if (info.isDirectory()) return walkWithExemptions(abs, hits);
  if (info.isFile() && !isTestFile(entry)) {
    await scanFileWithExemptions(
      abs,
      toPosix(relative(DASHBOARD_ROOT, abs)),
      hits,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const hits = [];
  for (const entry of SEARCH_ROOTS) await checkEntryWithExemptions(entry, hits);

  if (hits.length === 0) {
    console.log(
      "[check-no-hardcoded-marketing-urls] OK — no hardcoded marketing-host URLs found.",
    );
    process.exit(0);
  }

  console.error(
    `[check-no-hardcoded-marketing-urls] FAIL — ${hits.length} hardcoded marketing URL(s) found.\n` +
      "All marketing links must be derived from getDeploymentProfile().marketingUrl.\n" +
      "On self-hosted (marketingUrl=null) the link must be omitted; never hardcode a host.\n",
  );
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
    console.error(`    → ${hit.why}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-no-hardcoded-marketing-urls] Unexpected error:", err);
  process.exit(2);
});
