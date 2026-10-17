#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * check-ai-sdk-overrides: fails the build when a pnpm override of an AI SDK
 * package disagrees with the exact version that an installed AI SDK package
 * pins (dashboard#317).
 *
 * package.json pins `@ai-sdk/provider@4` and `@ai-sdk/provider-utils@5` with
 * pnpm overrides, so the tree holds one copy of each (dashboard#162). Each
 * `ai` and `@ai-sdk/*` release pins an exact provider version. When a bump
 * moves `ai` and the overrides stay, pnpm installs the old provider, and the
 * tests fail later with a missing export (dashboard#299, dashboard#313). This
 * guard names the override to move instead.
 *
 * It reads the installed `ai` and `@ai-sdk/*` packages under node_modules, so
 * it runs after `pnpm install`. pnpm links only direct dependencies there, so
 * the scan reads `ai` and the direct `@ai-sdk/*` packages, which pin both
 * overridden packages today. An override must be an exact version.
 *
 * The guard fails in five cases: an override disagrees with an installed
 * exact pin, an override matches no installed exact pin (a new major left it
 * dead), an installed package pins an overridden package at a major that no
 * override names (a one-package major bump split the tree), package.json has
 * no AI SDK override, or nothing is installed. A stale node_modules also
 * fails it, so run pnpm install first.
 *
 * `pnpm test` runs it before vitest, so a Dependabot bump fails here first
 * and not with a missing export. prebuild runs it for the image build.
 *
 * Usage: node scripts/check-ai-sdk-overrides.mjs [--selftest]
 * Exit codes: 0 every override agrees, 1 any of the five failures above.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-ai-sdk-overrides";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// An override key of the AI SDK family: `@ai-sdk/<name>@<major>` or `ai@<major>`.
const OVERRIDE_KEY = /^((?:@ai-sdk\/[a-z0-9-]+)|ai)@(\d+)$/;
const EXACT = /^(\d+)\.\d+\.\d+$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The installed AI SDK family packages: `ai` and each `@ai-sdk/*`. */
function installedFamily(root) {
  const nm = join(root, "node_modules");
  const out = [];
  if (existsSync(join(nm, "ai", "package.json"))) out.push(join(nm, "ai", "package.json"));
  const scope = join(nm, "@ai-sdk");
  if (existsSync(scope)) {
    for (const name of readdirSync(scope)) {
      const p = join(scope, name, "package.json");
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

/**
 * Compare each AI SDK override with the exact pins of the installed AI SDK
 * packages. Returns the list of problems, or null when nothing is installed.
 */
export function check(root) {
  const pkg = readJson(join(root, "package.json"));
  const overrides = pkg.pnpm?.overrides ?? {};
  const pins = [];
  for (const [key, value] of Object.entries(overrides)) {
    const m = OVERRIDE_KEY.exec(key);
    if (m) pins.push({ key, name: m[1], major: m[2], value, matched: 0, seen: [] });
  }
  const installed = installedFamily(root);
  if (installed.length === 0) return null;
  if (pins.length === 0) {
    return ["package.json has no AI SDK override, so the guard compares nothing (dashboard#162)."];
  }

  const problems = [];
  const overridden = new Map();
  for (const pin of pins) {
    if (!overridden.has(pin.name)) overridden.set(pin.name, new Set());
    overridden.get(pin.name).add(pin.major);
  }
  for (const path of installed) {
    const dep = readJson(path);
    const wants = { ...(dep.dependencies ?? {}) };
    for (const pin of pins) {
      const spec = wants[pin.name];
      const exact = spec && EXACT.exec(spec);
      if (!exact) continue;
      pin.seen.push(`${dep.name} ${dep.version} pins ${spec}`);
      if (exact[1] !== pin.major) continue;
      pin.matched += 1;
      if (spec !== pin.value) {
        problems.push(
          `${dep.name} ${dep.version} pins ${pin.name} ${spec}, but package.json overrides ` +
            `"${pin.key}" to "${pin.value}". Move the override to "${spec}".`,
        );
      }
    }
    for (const [name, majors] of overridden) {
      const exact = wants[name] && EXACT.exec(wants[name]);
      if (exact && !majors.has(exact[1])) {
        problems.push(
          `${dep.name} ${dep.version} pins ${name} ${wants[name]}, and no override names "${name}@${exact[1]}". ` +
            `The tree holds two copies of ${name}. Move every AI SDK package to one major, or add the override.`,
        );
      }
    }
  }
  for (const pin of pins) {
    if (pin.matched === 0) {
      const seen = pin.seen.length > 0 ? pin.seen.join(", ") : "no installed AI SDK package pins it";
      problems.push(
        `"${pin.key}" matches no installed exact pin of ${pin.name} ${pin.major}.x (${seen}). ` +
          `Move the override key and value to the major the AI SDK packages pin.`,
      );
    }
  }
  return problems;
}

export function report(root) {
  const problems = check(root);
  if (problems === null) {
    process.stderr.write(`${SCRIPT_NAME}: FAIL, no AI SDK package is installed. Run pnpm install first.\n`);
    return 1;
  }
  if (problems.length > 0) {
    process.stderr.write(
      `${SCRIPT_NAME}: FAIL, ${problems.length} AI SDK override problem(s). If you did not change package.json, ` +
        `run pnpm install first: a stale node_modules also fails this check.\n`,
    );
    for (const m of problems) process.stderr.write(`  ${m}\n`);
    process.stderr.write(
      `The overrides keep one copy of each AI SDK package (dashboard#162). Move each override to the version ` +
        `the AI SDK packages pin, then run pnpm install (dashboard#317).\n`,
    );
    return 1;
  }
  process.stdout.write(`${SCRIPT_NAME}: OK, every AI SDK override agrees with the installed pins.\n`);
  return 0;
}

function writeFixture(dir, overrides, aiDeps, reactDeps) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", pnpm: { overrides } }));
  if (aiDeps === undefined) return;
  mkdirSync(join(dir, "node_modules", "ai"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "ai", "package.json"),
    JSON.stringify({ name: "ai", version: "7.0.138", dependencies: aiDeps }),
  );
  if (reactDeps === undefined) return;
  mkdirSync(join(dir, "node_modules", "@ai-sdk", "react"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "@ai-sdk", "react", "package.json"),
    JSON.stringify({ name: "@ai-sdk/react", version: "4.0.141", dependencies: reactDeps }),
  );
}

function quiet(fn) {
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

function selftest() {
  const P = "@ai-sdk/provider@4";
  // name, overrides, ai dependencies (undefined: no install), want exit code, want text in the problems
  const cases = [
    ["stale override (dashboard#313)", { [P]: "4.0.21" }, { "@ai-sdk/provider": "4.0.27" }, 1, 'Move the override to "4.0.27"'],
    ["matching override", { [P]: "4.0.27", dompurify: "3.4.16" }, { "@ai-sdk/provider": "4.0.27" }, 0, null],
    ["no install", { [P]: "4.0.27" }, undefined, 1, null],
    ["no AI SDK override", { dompurify: "3.4.16" }, { "@ai-sdk/provider": "4.0.27" }, 1, "no AI SDK override"],
    ["new major leaves the override dead", { [P]: "4.0.27" }, { "@ai-sdk/provider": "5.0.0" }, 1, "matches no installed exact pin"],
    ["caret pin is not compared", { [P]: "4.0.27" }, { "@ai-sdk/provider": "^4.0.1" }, 1, "matches no installed exact pin"],
    [
      "other packages and majors are skipped",
      { [P]: "4.0.27" },
      { "@ai-sdk/provider": "4.0.27", "@ai-sdk/gateway": "4.0.111", zod: "3.25.76" },
      0,
      null,
    ],
    [
      "a one-package major bump splits the tree",
      { [P]: "4.0.27" },
      { "@ai-sdk/provider": "5.0.0" },
      1,
      'no override names "@ai-sdk/provider@5"',
      { "@ai-sdk/provider": "4.0.27" },
    ],
  ];
  let failures = 0;
  for (const [name, overrides, aiDeps, wantExit, wantText, reactDeps] of cases) {
    const dir = mkdtempSync(join(tmpdir(), "ai-sdk-overrides-selftest-"));
    try {
      writeFixture(dir, overrides, aiDeps, reactDeps);
      const exit = quiet(() => report(dir));
      const problems = check(dir);
      const text = problems ? problems.join("\n") : "";
      if (exit !== wantExit || (wantText && !text.includes(wantText))) {
        failures += 1;
        process.stderr.write(`${SCRIPT_NAME} --selftest: FAIL, case "${name}": exit ${exit}, want ${wantExit}. ${text}\n`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failures === 0) {
    process.stdout.write(
      `${SCRIPT_NAME} --selftest: PASS, ${cases.length} cases: the guard rejects a stale, dead or missing override ` +
        `and a missing install, and accepts a matching override.\n`,
    );
    return 0;
  }
  return 1;
}

const args = process.argv.slice(2);
process.exit(args.includes("--selftest") ? selftest() : report(ROOT));
