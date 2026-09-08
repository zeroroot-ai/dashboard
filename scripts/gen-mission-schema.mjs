#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * gen-mission-schema.mjs, copy the SDK's mission-definition.schema.json
 * into src/data/ and prepend a "$comment" field marking it as generated.
 *
 * Source of truth:
 *   gen/mission-definition.schema.json in a checkout of zeroroot-ai/sdk
 *
 * Output:
 *   src/data/mission-definition.schema.json
 *
 * Two modes
 * ---------
 *   node scripts/gen-mission-schema.mjs            # writes the output file
 *   node scripts/gen-mission-schema.mjs --stdout   # prints to stdout (for drift gate)
 *
 * The script is idempotent: running it twice with the same SDK source produces
 * byte-identical output.
 *
 * Workstation-only. Requires a checkout of zeroroot-ai/sdk next to this one.
 * CI does not run this generator; the freshness gate (check-mission-schema-fresh.mjs)
 * verifies the committed file is structurally valid and carries the $comment header.
 * Full regeneration + diff only runs when the SDK sibling is present.
 *
 * Closes: zeroroot-ai/dashboard#165
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoPath } from "./lib/workspace-root.mjs";

const SCRIPT_NAME = "gen-mission-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");

// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one.
const SDK_REPO = "sdk";
const SDK_SCHEMA_REL = "gen/mission-definition.schema.json";
const SDK_SCHEMA =
  resolveRepoPath(SDK_REPO, SDK_SCHEMA_REL, { from: DASHBOARD_ROOT })?.path ??
  resolve(DASHBOARD_ROOT, SDK_SCHEMA_REL);
const OUTPUT = resolve(
  DASHBOARD_ROOT,
  "src/data/mission-definition.schema.json",
);

const GENERATED_COMMENT =
  "DO NOT EDIT, generated from gen/mission-definition.schema.json in zeroroot-ai/sdk by scripts/gen-mission-schema.mjs. Run `node scripts/gen-mission-schema.mjs` to regenerate.";

function die(msg) {
  process.stderr.write(`${SCRIPT_NAME}: ${msg}\n`);
  process.exit(1);
}

function generate() {
  let raw;
  try {
    raw = readFileSync(SDK_SCHEMA, "utf8");
  } catch (err) {
    die(`cannot read ${SDK_SCHEMA}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(`SDK schema is not valid JSON: ${err.message}`);
  }

  // Inject $comment as the first key. JSON object insertion order is
  // preserved in V8 for string keys, so Object.assign with $comment first
  // guarantees it appears first in the serialised output.
  const output = { $comment: GENERATED_COMMENT, ...parsed };

  // Use 2-space indent + trailing newline for stable, diff-friendly output.
  return JSON.stringify(output, null, 2) + "\n";
}

const argv = process.argv.slice(2);
const stdoutMode = argv.includes("--stdout");

// --probe: report whether the SDK sibling is reachable, as JSON on stdout.
// check-mission-schema-fresh.mjs uses this to decide between a full byte-diff
// and a structural-only pass, so the generator that owns this path is the only
// thing that has to know it. Same contract as `proto-generate.mjs --probe`.
if (argv.includes("--probe")) {
  const present = existsSync(SDK_SCHEMA);
  process.stdout.write(
    JSON.stringify(
      { sources: { sdkSchema: present ? SDK_SCHEMA : null }, available: present },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

if (!existsSync(SDK_SCHEMA)) {
  if (stdoutMode) {
    die(
      `SDK schema not found at ${SDK_SCHEMA}\n` +
        "--stdout mode requires a checkout of zeroroot-ai/sdk next to this one.\n" +
        "The freshness check (check-mission-schema-fresh.mjs) should gate --stdout on SDK presence.",
    );
  }
  process.stderr.write(
    `${SCRIPT_NAME}: SKIPPED, SDK sibling not present at ${SDK_SCHEMA}.\n` +
      "The committed src/data/mission-definition.schema.json is used as-is; " +
      "the freshness gate validates its structure.\n",
  );
  process.exit(0);
}

const content = generate();

if (stdoutMode) {
  process.stdout.write(content);
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, content, "utf8");
  process.stderr.write(
    `${SCRIPT_NAME}: wrote ${OUTPUT}\n`,
  );
}
