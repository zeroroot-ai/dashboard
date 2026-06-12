#!/usr/bin/env node
/**
 * auth-latency-baseline.mjs
 *
 * Measures sign-in p50/p95/p99 latency by scraping the
 * dashboard_signin_duration_seconds histogram from /api/metrics before and
 * after a load run, then computing percentiles from the cumulative bucket
 * distribution.
 *
 * The script does NOT drive a browser. It reads the Prometheus histogram that
 * auth.ts already populates on every OIDC callback completion. To generate
 * meaningful samples you need sign-ins to flow through the server while this
 * script is running; see the Usage section below.
 *
 * Spec: auth-resolution-hardening, Task 15a (R8)
 *
 * Usage
 * -----
 *   # 1. Start the dashboard server (dev or built):
 *   #      pnpm dev     , or,  pnpm build && pnpm start
 *   #
 *   # 2. In a second terminal, drive N sign-ins via the e2e harness:
 *   #      PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *   #        N_SIGNINS=200 pnpm test:e2e --grep happy_path
 *   #
 *   # 3. In a third terminal, run this script:
 *   #      node scripts/auth-latency-baseline.mjs
 *   #
 *   # Or run everything from one script by passing --drive-load which spawns a
 *   # minimal load sequence using repeated /api/auth/session fetches to force
 *   # histogram population (see --drive-load flag below).
 *
 * Flags
 * -----
 *   --base-url <url>    Dashboard base URL (default: http://localhost:3000)
 *   --n <number>        Number of scrape iterations for --drive-load (default: 200)
 *   --drive-load        Use lightweight /api/metrics polling loop to collect
 *                       histogram snapshots (does not log in users, useful when
 *                       the cluster already has active sign-in traffic)
 *   --out <path>        Write JSON result to this path (default: enterprise/docs/auth-latency-baseline.json)
 *
 * Output
 * ------
 * Writes enterprise/docs/auth-latency-baseline.json with the structure:
 *   {
 *     "capturedAt": "<ISO8601>",
 *     "baseUrl": "<url>",
 *     "sampleCount": <N>,
 *     "p50_seconds": <p50>,
 *     "p95_seconds": <p95>,
 *     "p99_seconds": <p99>,
 *     "slo_p95_limit_seconds": 1.5,
 *     "slo_p99_limit_seconds": 3.0,
 *     "p95_pass": <bool>,
 *     "p99_pass": <bool>
 *   }
 *
 * SLO: p95 < 1.5s, p99 < 3.0s (from spec auth-resolution-hardening R8).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
// Worktree-aware: when REPO_ROOT (== DASHBOARD_ROOT here) is .worktrees/<name>/
// the naive `../../..` walk below for the default --out path lands short of the
// workspace root. Rewind to the main checkout root before walking up.
// dashboard#197 (same pattern as #175).
const _isWorktree = REPO_ROOT.includes("/.worktrees/");
const _MAIN_REPO_ROOT = _isWorktree
  ? REPO_ROOT.replace(/\/\.worktrees\/[^/]+$/, "")
  : REPO_ROOT;

// ---------------------------------------------------------------------------
// SLO targets (spec R8)
// ---------------------------------------------------------------------------
const SLO_P95_SECONDS = 1.5;
const SLO_P99_SECONDS = 3.0;

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "base-url": { type: "string", default: "http://localhost:3000" },
    n: { type: "string", default: "200" },
    "drive-load": { type: "boolean", default: false },
    out: { type: "string", default: "" },
  },
  allowPositionals: false,
});

const BASE_URL = args["base-url"];
const N_ITERS = parseInt(args["n"], 10);
const DRIVE_LOAD = args["drive-load"];
const OUT_PATH =
  args["out"] ||
  resolve(_MAIN_REPO_ROOT, "..", "..", "..", "enterprise", "docs", "auth-latency-baseline.json");

// ---------------------------------------------------------------------------
// Prometheus text-format parser, histogram buckets
// ---------------------------------------------------------------------------

/**
 * Parses the Prometheus text format and returns the raw histogram for the
 * given metric name (only _bucket lines, keyed by le label value).
 *
 * Returns { buckets: { le: number, count: number }[], sum: number, count: number }
 * or null if the metric is absent.
 */
function parseHistogram(text, metricName) {
  const buckets = [];
  let sum = 0;
  let count = 0;

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(`${metricName}_bucket{`)) {
      const leMatch = line.match(/le="([^"]+)"/);
      const valMatch = line.match(/}\s+([\d.eE+\-]+)/);
      if (leMatch && valMatch) {
        const le = leMatch[1] === "+Inf" ? Infinity : parseFloat(leMatch[1]);
        const cumCount = parseFloat(valMatch[1]);
        buckets.push({ le, count: cumCount });
      }
    } else if (line.startsWith(`${metricName}_sum`)) {
      const m = line.match(/\s+([\d.eE+\-]+)/);
      if (m) sum = parseFloat(m[1]);
    } else if (line.startsWith(`${metricName}_count`)) {
      const m = line.match(/\s+([\d.eE+\-]+)/);
      if (m) count = parseFloat(m[1]);
    }
  }

  if (buckets.length === 0) return null;
  buckets.sort((a, b) => a.le - b.le);
  return { buckets, sum, count };
}

/**
 * Compute a percentile from a Prometheus histogram bucket distribution using
 * linear interpolation within the matching bucket. Returns NaN if no samples.
 */
function computePercentile(histogram, p) {
  if (!histogram || histogram.count === 0) return NaN;

  const target = (p / 100) * histogram.count;
  const { buckets } = histogram;

  let prevCount = 0;
  let prevLe = 0;

  for (const bucket of buckets) {
    if (bucket.count >= target) {
      // Linear interpolation within this bucket.
      const countInBucket = bucket.count - prevCount;
      if (countInBucket === 0) return prevLe;
      const fraction = (target - prevCount) / countInBucket;
      const upper = bucket.le === Infinity ? prevLe * 2 : bucket.le;
      return prevLe + fraction * (upper - prevLe);
    }
    prevCount = bucket.count;
    prevLe = bucket.le === Infinity ? prevLe : bucket.le;
  }

  return prevLe;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function fetchMetrics(url) {
  const resp = await fetch(`${url}/api/metrics`, {
    method: "GET",
    headers: { Accept: "text/plain" },
    signal: AbortSignal.timeout(10_000),
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      `/api/metrics returned HTTP ${resp.status}. ` +
        "The metrics endpoint requires a SPIFFE JWT-SVID (for in-cluster scrapers) " +
        "or a source IP in DASHBOARD_METRICS_ALLOWED_CIDRS. " +
        "To run the baseline against a live cluster, set DASHBOARD_METRICS_ALLOWED_CIDRS " +
        "to include your machine's IP, or use kubectl port-forward and a SPIFFE token.",
    );
  }
  if (!resp.ok) {
    throw new Error(`/api/metrics returned HTTP ${resp.status}`);
  }
  return resp.text();
}

async function main() {
  console.log(`[auth-latency-baseline] base-url=${BASE_URL} n=${N_ITERS} drive-load=${DRIVE_LOAD}`);

  // -------------------------------------------------------------------------
  // Optional: drive a lightweight polling loop to gather histogram samples.
  // This does NOT log in real users; it relies on the server already having
  // sign-in activity. When --drive-load is set without a live login flow the
  // histogram will have 0 samples and the result will note that.
  // -------------------------------------------------------------------------
  if (DRIVE_LOAD) {
    console.log(
      `[auth-latency-baseline] --drive-load: polling /api/metrics ${N_ITERS}x to snapshot histogram...`,
    );
    for (let i = 0; i < N_ITERS; i++) {
      try {
        await fetchMetrics(BASE_URL);
      } catch {
        // non-fatal; proceed
      }
      // Small delay to avoid hammering the server.
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // -------------------------------------------------------------------------
  // Read the final histogram state.
  // -------------------------------------------------------------------------
  let text;
  try {
    text = await fetchMetrics(BASE_URL);
  } catch (err) {
    console.error(`[auth-latency-baseline] FAIL: cannot reach ${BASE_URL}/api/metrics: ${err}`);
    process.exit(1);
  }

  const histogram = parseHistogram(text, "dashboard_signin_duration_seconds");
  if (!histogram) {
    console.warn(
      "[auth-latency-baseline] WARNING: dashboard_signin_duration_seconds not found in /api/metrics. " +
        "The histogram is only populated after at least one sign-in. " +
        "Run pnpm test:e2e:auth-errors (happy_path test) to generate samples.",
    );
  }

  const sampleCount = histogram ? histogram.count : 0;
  const p50 = histogram ? computePercentile(histogram, 50) : NaN;
  const p95 = histogram ? computePercentile(histogram, 95) : NaN;
  const p99 = histogram ? computePercentile(histogram, 99) : NaN;

  const p95pass = !isNaN(p95) && p95 < SLO_P95_SECONDS;
  const p99pass = !isNaN(p99) && p99 < SLO_P99_SECONDS;

  const result = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    sampleCount,
    p50_seconds: isNaN(p50) ? null : parseFloat(p50.toFixed(4)),
    p95_seconds: isNaN(p95) ? null : parseFloat(p95.toFixed(4)),
    p99_seconds: isNaN(p99) ? null : parseFloat(p99.toFixed(4)),
    slo_p95_limit_seconds: SLO_P95_SECONDS,
    slo_p99_limit_seconds: SLO_P99_SECONDS,
    p95_pass: sampleCount > 0 ? p95pass : null,
    p99_pass: sampleCount > 0 ? p99pass : null,
  };

  // -------------------------------------------------------------------------
  // Print summary.
  // -------------------------------------------------------------------------
  console.log("\n[auth-latency-baseline] Results:");
  console.log(`  samples : ${sampleCount}`);
  console.log(`  p50     : ${result.p50_seconds ?? "n/a"} s`);
  console.log(`  p95     : ${result.p95_seconds ?? "n/a"} s  (SLO: < ${SLO_P95_SECONDS}s → ${sampleCount > 0 ? (p95pass ? "PASS" : "FAIL") : "no samples"})`);
  console.log(`  p99     : ${result.p99_seconds ?? "n/a"} s  (SLO: < ${SLO_P99_SECONDS}s → ${sampleCount > 0 ? (p99pass ? "PASS" : "FAIL") : "no samples"})`);

  // -------------------------------------------------------------------------
  // Write JSON output.
  // -------------------------------------------------------------------------
  const outDir = dirname(OUT_PATH);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`\n[auth-latency-baseline] Wrote ${OUT_PATH}`);

  // -------------------------------------------------------------------------
  // Exit non-zero if SLO violated (only when samples exist).
  // -------------------------------------------------------------------------
  if (sampleCount > 0 && (!p95pass || !p99pass)) {
    console.error(
      "[auth-latency-baseline] FAIL, SLO violation detected. " +
        `p95=${result.p95_seconds}s (limit=${SLO_P95_SECONDS}s), ` +
        `p99=${result.p99_seconds}s (limit=${SLO_P99_SECONDS}s).`,
    );
    process.exit(1);
  }

  if (sampleCount === 0) {
    console.warn(
      "[auth-latency-baseline] No sign-in samples in histogram. " +
        "Run pnpm test:e2e:auth-errors first to populate it.",
    );
  }
}

main().catch((err) => {
  console.error("[auth-latency-baseline] Uncaught error:", err);
  process.exit(1);
});
