#!/usr/bin/env node
/**
 * Build guard: verify that the **committed** `src/lib/billing/stripe_gen.ts`
 * matches what `gen-stripe-tiers.mjs` produces from the canonical
 * `enterprise/deploy/helm/gibson-operators/files/plans.yaml`.
 *
 * Until dashboard#1019 `prebuild` ran `gen-stripe-tiers.mjs` immediately
 * before this gate, so the gate diffed the file the generator had just written
 * against the generator, and could not fail. The generator no longer runs in
 * `prebuild`; regeneration is an explicit `pnpm gen:stripe-tiers`.
 *
 * Mechanics, modes and the no-escape-hatch stance live in
 * `scripts/lib/freshness-gate.mjs`.
 *
 * Usage
 *   node scripts/check-stripe-tiers-fresh.mjs
 *   node scripts/check-stripe-tiers-fresh.mjs --selftest
 *
 * Spec: plans-and-quotas-simplification R3.3 / R8.
 * Fixes: zeroroot-ai/dashboard#1019
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lib/freshness-gate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");
const ARTIFACT = "src/lib/billing/stripe_gen.ts";

main(
  {
    scriptName: "check-stripe-tiers-fresh.mjs",
    artifact: ARTIFACT,
    generator: resolve(__dirname, "gen-stripe-tiers.mjs"),
    generatedMarker: "// GENERATED FILE, do not edit.",
    resolution: "pnpm gen:stripe-tiers",
    maxBuffer: 16 * 1024 * 1024,
    sampleFrom: resolve(DASHBOARD_ROOT, ARTIFACT),
    syntheticSample:
      "// GENERATED FILE, do not edit.\nexport type BillingTier = never;\n",
  },
  process.argv.slice(2),
  DASHBOARD_ROOT,
);
