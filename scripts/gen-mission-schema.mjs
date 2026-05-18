#!/usr/bin/env node
/**
 * gen-mission-schema.mjs — copy the SDK's mission-definition.schema.json
 * into src/data/ and prepend a "$comment" field marking it as generated.
 *
 * Source of truth:
 *   opensource/sdk/gen/mission-definition.schema.json
 *   (sibling checkout at ~/Code/zero-day.ai/ polyrepo workspace root)
 *
 * Output:
 *   enterprise/platform/dashboard/src/data/mission-definition.schema.json
 *
 * Two modes
 * ---------
 *   node scripts/gen-mission-schema.mjs            # writes the output file
 *   node scripts/gen-mission-schema.mjs --stdout   # prints to stdout (for drift gate)
 *
 * The script is idempotent: running it twice with the same SDK source produces
 * byte-identical output.
 *
 * Workstation-only. Requires the polyrepo sibling clone of opensource/sdk at
 *   ~/Code/zero-day.ai/opensource/sdk/gen/mission-definition.schema.json
 * CI does not run this generator; the freshness gate (check-mission-schema-fresh.mjs)
 * verifies the committed file is structurally valid and carries the $comment header.
 * Full regeneration + diff only runs when the SDK sibling is present.
 *
 * Closes: zero-day-ai/dashboard#165
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "gen-mission-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");

// Worktree-aware: when run from .worktrees/<name>/scripts/, DASHBOARD_ROOT
// resolves to the worktree directory and the naive `../../..` walks short
// of the polyrepo workspace root. Strip the `.worktrees/<name>` suffix to
// reach the canonical dashboard checkout, then walk up to the workspace.
// Sister scripts proto-generate.mjs + gen-authz-registry.mjs use the same
// pattern.
const isWorktree = DASHBOARD_ROOT.includes("/.worktrees/");
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.worktrees\/[^/]+$/, "")
  : DASHBOARD_ROOT;
const REPO_ROOT = resolve(MAIN_DASHBOARD_ROOT, "..", "..", "..");

const SDK_SCHEMA = resolve(
  REPO_ROOT,
  "opensource/sdk/gen/mission-definition.schema.json",
);
const OUTPUT = resolve(
  DASHBOARD_ROOT,
  "src/data/mission-definition.schema.json",
);

const GENERATED_COMMENT =
  "DO NOT EDIT — generated from opensource/sdk/gen/mission-definition.schema.json by scripts/gen-mission-schema.mjs. Run `node scripts/gen-mission-schema.mjs` to regenerate.";

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

if (!existsSync(SDK_SCHEMA)) {
  if (stdoutMode) {
    die(
      `SDK schema not found at ${SDK_SCHEMA}\n` +
        "--stdout mode requires the polyrepo sibling clone of opensource/sdk.\n" +
        "The freshness check (check-mission-schema-fresh.mjs) should gate --stdout on SDK presence.",
    );
  }
  process.stderr.write(
    `${SCRIPT_NAME}: SKIPPED — SDK sibling not present at ${SDK_SCHEMA}.\n` +
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
