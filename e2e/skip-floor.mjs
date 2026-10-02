#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * skip-floor.mjs, the staging lane's floor under "green by being empty".
 *
 * Playwright exits 0 when every test skipped. The specs skip when a
 * credential is unset, so a lane whose secrets are missing would report
 * success while proving nothing (dashboard#163). This script reads the JSON
 * report Playwright wrote and fails when:
 *
 *   - the report holds zero tests, or
 *   - every test skipped, or
 *   - fewer than MIN_RAN tests ran (default 1, E2E_MIN_RAN overrides).
 *
 * It prints the counts and every skip with its reason, so the log says what
 * was measured. A green run here means at least one test ran to a verdict.
 *
 * Usage:
 *   node e2e/skip-floor.mjs playwright-report/test-results.json
 *   node e2e/skip-floor.mjs --selftest
 *
 * --selftest proves the floor can fail: an all-skipped report and an empty
 * report are refused, a report with one passed test is accepted.
 */

import { readFileSync } from "node:fs";

const NAME = "skip-floor";

/**
 * Walks the Playwright JSON report and returns every test result with its
 * title, status and skip reason. One spec can hold several results (retries,
 * projects); the floor counts the last result of each test.
 */
export function collectTests(report) {
  const out = [];
  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const last = results[results.length - 1];
        const skipAnnotation = (t.annotations ?? []).find((a) => a.type === "skip");
        out.push({
          title: [...here, spec.title].join(" > "),
          status: last?.status ?? t.status ?? "unknown",
          outcome: t.status ?? "unknown",
          reason: skipAnnotation?.description ?? "",
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

/**
 * Returns { ok, ran, skipped, total, lines }. `ok` is false when the floor is
 * not met. `lines` is the human report.
 */
export function evaluate(report, minRan = 1) {
  const tests = collectTests(report);
  const total = tests.length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const ran = total - skipped;
  const lines = [];
  lines.push(`${NAME}: ${total} test(s) in the report, ${ran} ran, ${skipped} skipped`);
  for (const t of tests.filter((t) => t.status === "skipped")) {
    lines.push(`  skipped: ${t.title}${t.reason ? ` (${t.reason})` : ""}`);
  }
  let ok = true;
  if (total === 0) {
    ok = false;
    lines.push(`${NAME}: FAIL, the report holds no tests. Playwright matched no spec, or wrote no report.`);
  } else if (ran === 0) {
    ok = false;
    lines.push(
      `${NAME}: FAIL, every test skipped. The lane proved nothing. ` +
        "Set the credential secrets the skip reasons name (e2e/README.md).",
    );
  } else if (ran < minRan) {
    ok = false;
    lines.push(`${NAME}: FAIL, ${ran} test(s) ran and the floor is ${minRan}.`);
  } else {
    lines.push(`${NAME}: OK, ${ran} test(s) ran to a verdict.`);
  }
  return { ok, ran, skipped, total, lines };
}

function fixture(statuses) {
  return {
    suites: [
      {
        title: "fixture.spec.ts",
        specs: statuses.map((status, i) => ({
          title: `test ${i + 1}`,
          tests: [
            {
              status: status === "passed" ? "expected" : status,
              annotations: status === "skipped" ? [{ type: "skip", description: "E2E_ADMIN_EMAIL is not set" }] : [],
              results: [{ status }],
            },
          ],
        })),
      },
    ],
  };
}

function selftest() {
  const cases = [
    { name: "an all-skipped report is refused", report: fixture(["skipped", "skipped", "skipped"]), want: false },
    { name: "an empty report is refused", report: { suites: [] }, want: false },
    { name: "a report with no suites key is refused", report: {}, want: false },
    { name: "one passed test beside skips is accepted", report: fixture(["skipped", "passed", "skipped"]), want: true },
    { name: "one failed test still counts as ran", report: fixture(["failed", "skipped"]), want: true },
    { name: "a floor of 3 refuses 2 ran", report: fixture(["passed", "passed", "skipped"]), want: false, minRan: 3 },
  ];
  let failures = 0;
  for (const c of cases) {
    const got = evaluate(c.report, c.minRan ?? 1).ok;
    if (got !== c.want) {
      failures += 1;
      console.error(`  FAIL ${c.name}: ok=${got}, want ${c.want}`);
    } else {
      console.log(`  ok   ${c.name}`);
    }
  }
  if (failures > 0) {
    console.error(`${NAME}: SELFTEST FAIL, ${failures} case(s) cannot fail correctly`);
    return 1;
  }
  console.log(`${NAME}: SELFTEST PASS (${cases.length} cases)`);
  return 0;
}

function main(argv) {
  if (argv.includes("--selftest")) return selftest();
  const path = argv.find((a) => !a.startsWith("--"));
  if (!path) {
    console.error(`usage: node e2e/skip-floor.mjs <playwright-report/test-results.json> | --selftest`);
    return 2;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`${NAME}: FAIL, cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const minRan = Number(process.env.E2E_MIN_RAN ?? "1");
  const verdict = evaluate(report, Number.isFinite(minRan) && minRan > 0 ? minRan : 1);
  for (const line of verdict.lines) console.log(line);
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main(process.argv.slice(2)));
}
