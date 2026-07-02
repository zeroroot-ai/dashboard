#!/usr/bin/env node
/**
 * check-docs-cli-name.mjs
 *
 * Build-time guard enforcing the no-`gibson-cli`-in-docs invariant from
 * dashboard#99 (parent: PRD #97). The CLI binary is `gibson`
 * (not `gibson-cli`); every reference in committed `content/docs/*.mdx`
 * must use the modern name.
 *
 * Existing violations are captured in `.docs-cli-allowlist.json` at the
 * repo root. The list is monotonic-shrink only:
 *
 *   - New violation (not in allowlist) → FAIL.
 *   - Allowlist entry whose source line no longer matches → FAIL with
 *     a hint to run `--shrink` and commit the result.
 *
 * Modes:
 *
 *   (default)    Scan; compare to allowlist; fail on drift in either
 *                direction.
 *   --shrink     Regenerate `.docs-cli-allowlist.json` by removing
 *                entries that no longer match in source. Never adds
 *                new entries.
 *   --seed       One-shot: regenerate `.docs-cli-allowlist.json` from
 *                the current scan. Use ONCE at #99 land time to
 *                bootstrap; CI rejects this mode going forward.
 *   --selftest   Synthesises a temp MDX file with a `gibson-cli` line,
 *                asserts the scanner catches it, cleans up.
 *
 * Mirrors the pattern from scripts/check-no-hardcoded-colors.mjs.
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "content", "docs");
const ALLOWLIST_PATH = join(ROOT, ".docs-cli-allowlist.json");
const FORBIDDEN = /gibson-cli/;

function* walkMdx(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walkMdx(path);
    } else if (entry.endsWith(".mdx")) {
      yield path;
    }
  }
}

function scan() {
  const hits = [];
  if (!existsSync(SCAN_DIR)) return hits;
  for (const file of walkMdx(SCAN_DIR)) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) {
        hits.push({
          file: relative(ROOT, file),
          line: i + 1,
          source: line.trim(),
        });
      }
    });
  }
  return hits;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    console.error(`✗ failed to parse ${ALLOWLIST_PATH}: ${err.message}`);
    process.exit(1);
  }
}

function entryKey(e) {
  return `${e.file}:${e.line}`;
}

function compare(hits, allowlist) {
  const hitMap = new Map(hits.map((h) => [entryKey(h), h]));
  const allowMap = new Map(allowlist.map((a) => [entryKey(a), a]));

  const newViolations = [];
  for (const [k, h] of hitMap) {
    if (!allowMap.has(k)) {
      newViolations.push(h);
      continue;
    }
    if (allowMap.get(k).source !== h.source) {
      // Same file+line but content changed, treat as a new violation
      // (the allowlist entry is for a different concrete violation).
      newViolations.push(h);
    }
  }

  const stale = [];
  for (const [k, a] of allowMap) {
    if (!hitMap.has(k) || hitMap.get(k).source !== a.source) {
      stale.push(a);
    }
  }
  return { newViolations, stale };
}

function selftest() {
  const tempFile = join(SCAN_DIR, "__selftest__.mdx");
  writeFileSync(tempFile, "Use `gibson-cli inspect` to verify.\n");
  try {
    const hits = scan();
    const found = hits.find((h) => h.file.endsWith("__selftest__.mdx"));
    if (!found) {
      console.error("✗ selftest FAILED: scanner did not catch gibson-cli in synthesized file");
      process.exit(1);
    }
    console.log("✓ selftest passed (scanner catches gibson-cli)");
  } finally {
    unlinkSync(tempFile);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--selftest")) {
    selftest();
    return;
  }

  const hits = scan();

  if (args.has("--seed")) {
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(hits, null, 2) + "\n");
    console.log(`✓ seeded ${ALLOWLIST_PATH} with ${hits.length} entry(s)`);
    return;
  }

  const allowlist = loadAllowlist();

  if (args.has("--shrink")) {
    const hitKeys = new Set(hits.map(entryKey));
    const hitSources = new Map(hits.map((h) => [entryKey(h), h.source]));
    const kept = allowlist.filter(
      (a) => hitKeys.has(entryKey(a)) && hitSources.get(entryKey(a)) === a.source,
    );
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(kept, null, 2) + "\n");
    console.log(
      `✓ shrunk allowlist: ${allowlist.length} → ${kept.length} entries`,
    );
    return;
  }

  const { newViolations, stale } = compare(hits, allowlist);

  if (newViolations.length === 0 && stale.length === 0) {
    console.log(
      `✓ check-docs-cli-name: ${hits.length} allowlisted, 0 new violations`,
    );
    return;
  }

  if (newViolations.length > 0) {
    console.error(
      `✗ check-docs-cli-name: ${newViolations.length} new "gibson-cli" reference(s) in committed docs.`,
    );
    console.error(`  The CLI binary is "gibson", not "gibson-cli".`);
    console.error(`  Replace each hit, then re-run.\n`);
    for (const v of newViolations) {
      console.error(`  ${v.file}:${v.line}  ${v.source}`);
    }
  }

  if (stale.length > 0) {
    console.error(
      `\n✗ check-docs-cli-name: ${stale.length} stale allowlist entry(s).`,
    );
    console.error(`  Run "node scripts/check-docs-cli-name.mjs --shrink" and commit.\n`);
    for (const s of stale) {
      console.error(`  ${s.file}:${s.line}  ${s.source}`);
    }
  }

  process.exit(1);
}

main();
