#!/usr/bin/env node
/**
 * Build guard: verify that the **committed** `src/generated/plans.ts` matches
 * what `gen-plans.mjs` produces from the canonical
 * `enterprise/deploy/helm/gibson-operators/files/plans.yaml`.
 *
 * Until dashboard#1019 `prebuild` ran `gen-plans.mjs` immediately before this
 * gate, so the gate diffed the file the generator had just written against the
 * generator. It could not fail, and it did not: `src/generated/plans.ts` sat
 * committed with two taglines that `plans.yaml` had already superseded. The
 * generator no longer runs in `prebuild`; regeneration is an explicit
 * `pnpm gen:plans`.
 *
 * Mechanics, modes and the no-escape-hatch stance live in
 * `scripts/lib/freshness-gate.mjs`.
 *
 * Usage
 *   node scripts/check-plans-fresh.mjs
 *   node scripts/check-plans-fresh.mjs --selftest
 *
 * Resolution
 *   pnpm gen:plans, then commit src/generated/plans.ts alongside the
 *   plans.yaml change.
 *
 * Spec: plans-and-quotas-simplification (R3.3 drift gate).
 * Fixes: zeroroot-ai/dashboard#1019
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lib/freshness-gate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");
const ARTIFACT = "src/generated/plans.ts";

main(
  {
    scriptName: "check-plans-fresh.mjs",
    artifact: ARTIFACT,
    generator: resolve(__dirname, "gen-plans.mjs"),
    generatedMarker: "// GENERATED FILE, do not edit.",
    resolution: "pnpm gen:plans",
    maxBuffer: 16 * 1024 * 1024,
    sampleFrom: resolve(DASHBOARD_ROOT, ARTIFACT),
    syntheticSample:
      "// GENERATED FILE, do not edit.\nexport const plans = [];\n",
  },
  process.argv.slice(2),
  DASHBOARD_ROOT,
);
