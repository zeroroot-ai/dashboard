#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: every Prometheus metric declared under `src/lib/metrics/`
 * has a production producer.
 *
 * Why this exists
 * ---------------
 * dashboard#173: `src/lib/metrics/auth.ts` declared 16 metrics and 13 of
 * them could never emit a non-zero value. Seven were the auth-abuse signals
 * an operator reaches for during an incident, and one was the documented
 * way to tell whether a security backout was active. A declared series
 * with no producer reads as coverage on a dashboard and is not. This is
 * the consumer-side assertion for the metrics layer (ADR-0094).
 *
 * Detection
 * ---------
 * A declaration is `const NAME = getOrCreateCounter(` / `getOrCreateHistogram(`
 * / `getOrCreateGauge(` in any non-test file under `src/lib/metrics/`.
 * A producer is `NAME.inc(`, `NAME.observe(`, `NAME.set(`, `NAME.dec(`,
 * `NAME.labels(` or `NAME.startTimer(` in any production source file,
 * including the declaring file. Test files, generated code and build output
 * are never producers.
 *
 * The guard refuses to pass on a scan that found zero declarations, so a
 * moved directory cannot turn it green by emptiness.
 *
 * Self-test
 * ---------
 * `--selftest` writes one fixture with a counter nothing increments and
 * asserts the guard rejects it, then one fixture that increments its own
 * counter and asserts the guard accepts it. Both fixtures are removed.
 *
 * Exit codes: 0 = every metric has a producer, 1 = at least one has none.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-metrics-have-producers";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const METRICS_DIR = join(ROOT, "src", "lib", "metrics");

const PRODUCTION_ROOTS = ["app", "src", "components", "lib", "hooks"];
const PRODUCTION_FILES = ["auth.ts", "middleware.ts", "instrumentation.ts"];
const SOURCE_EXT = /\.(ts|tsx)$/;
const EXCLUDED_DIR = new Set(["node_modules", ".next", ".worktrees", "__tests__", "gen", "generated", "fixtures"]);
const EXCLUDED_FILE = /\.(test|spec)\.(ts|tsx)$|\.d\.ts$/;

const DECLARATION_RE = /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*getOrCreate(?:Counter|Histogram|Gauge)\s*\(/g;
const PRODUCER_METHODS = ["inc", "observe", "set", "dec", "labels", "startTimer"];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (SOURCE_EXT.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function productionFiles() {
  const files = [];
  for (const r of PRODUCTION_ROOTS) walk(join(ROOT, r), files);
  for (const f of PRODUCTION_FILES) {
    const p = join(ROOT, f);
    try {
      if (statSync(p).isFile()) files.push(p);
    } catch {
      // absent at the root, fine
    }
  }
  return files;
}

function declarations() {
  const found = [];
  for (const file of walk(METRICS_DIR, [])) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(DECLARATION_RE)) {
      found.push({ name: m[1], file: relative(ROOT, file) });
    }
  }
  return found;
}

function producerPattern(name) {
  return new RegExp(`\\b${name}\\.(?:${PRODUCER_METHODS.join("|")})\\(`);
}

/** Returns { declared, scanned, orphans } for the tree at ROOT. */
function scan() {
  const declared = declarations();
  const files = productionFiles();
  const sources = files.map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  const orphans = [];
  for (const d of declared) {
    const re = producerPattern(d.name);
    const hit = sources.some((s) => re.test(s.text));
    if (!hit) orphans.push(d);
  }
  return { declared, scanned: files.length, orphans };
}

function report(result) {
  process.stdout.write(
    `${SCRIPT_NAME}: ${result.declared.length} metric declarations under src/lib/metrics, ` +
      `${result.scanned} production files scanned\n`,
  );
  if (result.declared.length === 0) {
    process.stderr.write(`${SCRIPT_NAME}: FAIL, zero declarations found. A scan that sees nothing proves nothing.\n`);
    return 1;
  }
  if (result.orphans.length > 0) {
    process.stderr.write(`${SCRIPT_NAME}: FAIL, ${result.orphans.length} metric(s) have no producer:\n`);
    for (const o of result.orphans) {
      process.stderr.write(`  ${o.file}: ${o.name}\n`);
    }
    process.stderr.write(
      `Increment the metric at the event it measures, or delete the declaration. ` +
        `A series nothing writes reads as coverage and is not (dashboard#173).\n`,
    );
    return 1;
  }
  return 0;
}

function selftest() {
  const orphanFixture = join(METRICS_DIR, "__producers_selftest_orphan.ts");
  const wiredFixture = join(METRICS_DIR, "__producers_selftest_wired.ts");
  let failures = 0;
  try {
    writeFileSync(
      orphanFixture,
      `import { getOrCreateCounter } from "./helpers";\n` +
        `export const selftestOrphanTotal = getOrCreateCounter({ name: "selftest_orphan_total", help: "x" });\n`,
    );
    const a = scan();
    if (!a.orphans.some((o) => o.name === "selftestOrphanTotal")) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, a counter nothing increments was not reported.\n`);
    }
    unlinkSync(orphanFixture);

    writeFileSync(
      wiredFixture,
      `import { getOrCreateCounter } from "./helpers";\n` +
        `const selftestWiredTotal = getOrCreateCounter({ name: "selftest_wired_total", help: "x" });\n` +
        `export function recordSelftest(): void { selftestWiredTotal.inc(); }\n`,
    );
    const b = scan();
    if (b.orphans.some((o) => o.name === "selftestWiredTotal")) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, a counter its own file increments was reported.\n`);
    }
    if (b.declared.length < 2) {
      failures += 1;
      process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, the scan saw ${b.declared.length} declarations, so the floor cannot hold.\n`);
    }
  } finally {
    for (const f of [orphanFixture, wiredFixture]) {
      try {
        unlinkSync(f);
      } catch {
        // already removed
      }
    }
  }
  if (failures === 0) {
    process.stdout.write(`${SCRIPT_NAME} --selftest: PASS, the guard rejects an orphan and accepts a wired metric.\n`);
    return 0;
  }
  return 1;
}

const args = process.argv.slice(2);
process.exit(args.includes("--selftest") ? selftest() : report(scan()));
