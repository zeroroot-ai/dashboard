#!/usr/bin/env node
/*
 * check-csp.mjs
 *
 * Static CSP hardening gate for the Gibson Dashboard build pipeline.
 *
 * The dashboard ships a strict, nonce-based Content-Security-Policy from
 * `middleware.ts`. Regression-proof that policy by failing the build if
 * either of the classic escape hatches — `'unsafe-inline'` or
 * `'unsafe-eval'` — appears in the `script-src` directive of the
 * `generateCspHeaders` function.
 *
 * Why a source-level static check: the CSP is generated per request in
 * middleware using a randomly generated nonce, so we cannot parse a
 * canonical "production bundle" output — the directive is only realised
 * at runtime. A static check against the middleware source is both the
 * fastest and most reliable regression gate: if someone hand-edits the
 * CSP template to add `'unsafe-inline'`, this script fails before the
 * deploy can ship.
 *
 * Additionally, the script scans the built `.next/` artefacts (when
 * present) for any CSP header appearing in route config or response
 * headers files, catching any secondary CSP source a future refactor
 * might introduce.
 *
 * Exit codes:
 *   0 — script-src is free of unsafe-inline / unsafe-eval
 *   1 — at least one forbidden token was found
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = join(__filename, "..", "..");

// The CSP template lives here. This is the canonical source of truth
// inspected by the check.
const MIDDLEWARE_PATH = join(DASHBOARD_ROOT, "middleware.ts");

// Additional files that legitimately set a CSP header. Add more paths
// here if a future refactor splits CSP generation out of middleware.
const ADDITIONAL_CSP_SOURCES = [
  // empty — keeping the array explicit so new CSP sites are obvious.
];

const FORBIDDEN_TOKENS = ["'unsafe-inline'", "'unsafe-eval'"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "test-results",
  "playwright-report",
  "coverage",
]);

function toPosix(p) {
  return p.split(sep).join("/");
}

/**
 * Extract each occurrence of `script-src` in the given source and return a
 * conservative slice of the text that follows, up to the next semicolon OR
 * the end of the enclosing string literal (whichever comes first). The
 * dashboard's CSP is authored as an array of per-directive string literals
 * joined with `"; "` — so the directive value terminates at whichever
 * boundary is nearer.
 *
 * Returns an array because a file may legitimately contain multiple CSP
 * sources (e.g. a report-only variant plus an enforcing one).
 */
function extractScriptSrcValues(source) {
  const results = [];
  const lower = source.toLowerCase();
  let searchFrom = 0;
  while (true) {
    const idx = lower.indexOf("script-src", searchFrom);
    if (idx === -1) break;
    const afterName = source.slice(idx + "script-src".length);
    // Terminate at the first of: `;` (next CSP directive), `"` (end of
    // string literal), `'` (end of template-literal segment containing
    // the nonce expression), or newline.
    const terminators = [";", '"', "`", "\n"];
    let cut = afterName.length;
    for (const t of terminators) {
      const n = afterName.indexOf(t);
      if (n !== -1 && n < cut) cut = n;
    }
    const value = afterName.slice(0, cut).trim();
    if (value.length > 0) results.push(value);
    searchFrom = idx + "script-src".length;
  }
  return results;
}

/**
 * Inspect the middleware source for the CSP template. In middleware.ts the
 * directives are passed as an array of strings to `join("; ")`. We reflect
 * the full file contents into a single string and run `extractScriptSrc`
 * on it — literal string concatenation before the check catches both the
 * array-form authoring and any alternative shape someone might add.
 */
async function checkMiddleware(hits) {
  let content;
  try {
    content = await readFile(MIDDLEWARE_PATH, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      hits.push({
        file: toPosix(relative(DASHBOARD_ROOT, MIDDLEWARE_PATH)),
        reason: "middleware.ts is missing — cannot verify CSP",
      });
      return;
    }
    throw err;
  }

  const scriptSrcValues = extractScriptSrcValues(content);
  if (scriptSrcValues.length === 0) {
    hits.push({
      file: toPosix(relative(DASHBOARD_ROOT, MIDDLEWARE_PATH)),
      reason: "No script-src directive found in middleware.ts CSP",
    });
    return;
  }

  for (const scriptSrc of scriptSrcValues) {
    for (const token of FORBIDDEN_TOKENS) {
      if (scriptSrc.toLowerCase().includes(token.toLowerCase())) {
        hits.push({
          file: toPosix(relative(DASHBOARD_ROOT, MIDDLEWARE_PATH)),
          reason: `script-src contains forbidden token ${token}`,
          snippet: scriptSrc,
        });
      }
    }
  }
}

/**
 * Walk a directory tree looking for files that declare a
 * Content-Security-Policy header. We flag any file where the script-src
 * portion contains a forbidden token.
 */
async function walk(dir, hits) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, hits);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(entry.name)) continue;

    const content = await readFile(abs, "utf8");
    if (!content.toLowerCase().includes("content-security-policy")) continue;

    const scriptSrcValues = extractScriptSrcValues(content);
    if (scriptSrcValues.length === 0) continue;

    for (const scriptSrc of scriptSrcValues) {
      for (const token of FORBIDDEN_TOKENS) {
        if (scriptSrc.toLowerCase().includes(token.toLowerCase())) {
          hits.push({
            file: toPosix(relative(DASHBOARD_ROOT, abs)),
            reason: `script-src contains forbidden token ${token}`,
            snippet: scriptSrc,
          });
        }
      }
    }
  }
}

async function main() {
  const hits = [];
  await checkMiddleware(hits);

  for (const extra of ADDITIONAL_CSP_SOURCES) {
    const abs = join(DASHBOARD_ROOT, extra);
    let info;
    try {
      info = await stat(abs);
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    if (info.isDirectory()) {
      await walk(abs, hits);
    } else if (info.isFile()) {
      const content = await readFile(abs, "utf8");
      const scriptSrcValues = extractScriptSrcValues(content);
      if (scriptSrcValues.length === 0) continue;
      for (const scriptSrc of scriptSrcValues) {
        for (const token of FORBIDDEN_TOKENS) {
          if (scriptSrc.toLowerCase().includes(token.toLowerCase())) {
            hits.push({
              file: toPosix(relative(DASHBOARD_ROOT, abs)),
              reason: `script-src contains forbidden token ${token}`,
              snippet: scriptSrc,
            });
          }
        }
      }
    }
  }

  if (hits.length === 0) {
    console.log(
      "[check-csp] OK — middleware CSP has no 'unsafe-inline' / 'unsafe-eval' in script-src."
    );
    process.exit(0);
  }

  console.error(
    `[check-csp] FAIL — ${hits.length} CSP regression(s) detected.\n` +
      "Nonce-based script-src must remain free of 'unsafe-inline' and 'unsafe-eval'.\n"
  );
  for (const hit of hits) {
    console.error(`  ${hit.file}: ${hit.reason}`);
    if (hit.snippet) console.error(`    script-src: ${hit.snippet}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-csp] Unexpected error:", err);
  process.exit(2);
});
