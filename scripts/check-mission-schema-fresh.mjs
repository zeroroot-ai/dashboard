#!/usr/bin/env node
/**
 * Build guard: verify that the **committed**
 * `src/data/mission-definition.schema.json` matches what
 * `gen-mission-schema.mjs` produces from the SDK's authoritative artifact at
 * `opensource/sdk/gen/mission-definition.schema.json`.
 *
 * Until dashboard#1019 `prebuild` ran `gen-mission-schema.mjs` immediately
 * before this gate, so the gate diffed the file the generator had just written
 * against the generator, and could not fail. The generator no longer runs in
 * `prebuild`; regeneration is an explicit `pnpm gen:mission-schema`.
 *
 * Mechanics, modes and the no-escape-hatch stance live in
 * `scripts/lib/freshness-gate.mjs`. This gate no longer resolves the SDK
 * sibling itself (dashboard#1015 / #1018): it asks `gen-mission-schema.mjs
 * --probe`, so the script that owns the path is the only one that knows it.
 * The structural pass here additionally
 * requires the artifact to parse as JSON and to carry the "DO NOT EDIT"
 * `$comment` header, which is what proves it came out of the generator rather
 * than out of an editor.
 *
 * Usage
 *   node scripts/check-mission-schema-fresh.mjs
 *   node scripts/check-mission-schema-fresh.mjs --selftest
 *
 * Closes: zeroroot-ai/dashboard#165
 * Fixes: zeroroot-ai/dashboard#1019
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lib/freshness-gate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");
const ARTIFACT = "src/data/mission-definition.schema.json";
const DO_NOT_EDIT_PREFIX = "DO NOT EDIT";

/** JSON syntax plus the generator's `$comment` marker, in one validator. */
function validate(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return `not valid JSON: ${err.message}`;
  }
  if (
    typeof parsed.$comment !== "string" ||
    !parsed.$comment.startsWith(DO_NOT_EDIT_PREFIX)
  ) {
    return `missing the "${DO_NOT_EDIT_PREFIX}" $comment header`;
  }
  return null;
}

main(
  {
    scriptName: "check-mission-schema-fresh.mjs",
    artifact: ARTIFACT,
    generator: resolve(__dirname, "gen-mission-schema.mjs"),
    generatedMarker: DO_NOT_EDIT_PREFIX,
    validate,
    resolution: "pnpm gen:mission-schema",
    maxBuffer: 16 * 1024 * 1024,
    sampleFrom: resolve(DASHBOARD_ROOT, ARTIFACT),
    syntheticSample: JSON.stringify(
      { $comment: `${DO_NOT_EDIT_PREFIX}, generated.`, type: "object" },
      null,
      2,
    ),
  },
  process.argv.slice(2),
  DASHBOARD_ROOT,
);
