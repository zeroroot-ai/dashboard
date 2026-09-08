#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * gen-stripe-tiers.mjs, emits src/lib/billing/stripe_gen.ts from
 * plans.yaml. Single bridge between the operator's plan registry and the
 * dashboard's BillingTier union + LOOKUP_KEY_MAP. Spec
 * plans-and-quotas-simplification R8 / R3.1.
 *
 * The generated file carries:
 *   - BillingTier    : TS union of every plan id whose pricing has
 *                      stripeProductId support (i.e. NOT contactSales-only).
 *   - LOOKUP_KEY_MAP : { [tier]: "gibson_<id>_monthly_usd" }, the stable
 *                      Stripe lookup_key for each paid tier. These are
 *                      identical across every Stripe account and test/live
 *                      mode, so no per-environment price ID env vars are
 *                      needed. stripe.ts uses prices.list({lookup_keys:[...]})
 *                      to resolve the live price ID at runtime.
 *
 * stripe.ts imports these and keeps the runtime helpers (priceIdForTier /
 * validateBillingConfig). Drift is caught by check-stripe-tiers-fresh.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { requireRepoPath, resolveRepoPath } from "./lib/workspace-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(HERE, "..");
// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. The canonical plan registry
// lives in the public `charts` repository (ADR-0086), the same copy gen-plans.mjs
// reads.
const PLANS_REPO = "charts";
const PLANS_REL = "helm/gibson-operators/files/plans.yaml";
const OUTPUT = resolve(DASHBOARD_ROOT, "src/lib/billing/stripe_gen.ts");

function die(msg) {
  process.stderr.write(`gen-stripe-tiers: ${msg}\n`);
  process.exit(1);
}

/**
 * Report whether the canonical plan registry is reachable, as JSON on stdout.
 * `check-stripe-tiers-fresh.mjs` uses this to decide between a full byte-diff
 * and a structural-only pass, so the generator that owns this path is the only
 * thing that has to know it. Same contract as `proto-generate.mjs --probe`.
 */
function probe() {
  // Same search main() uses, but non-fatal: --probe asks "is this
  // reachable?", so absence is an answer rather than an error.
  const yaml = resolveRepoPath(PLANS_REPO, PLANS_REL, { from: DASHBOARD_ROOT })?.path ?? null;
  process.stdout.write(
    JSON.stringify({ sources: { yaml }, available: Boolean(yaml) }, null, 2) + "\n",
  );
}

function main() {
  const stdoutMode = process.argv.slice(2).includes("--stdout");

  if (process.argv.slice(2).includes("--probe")) {
    probe();
    return;
  }

  // Docker image builds skip regen and trust the committed stripe_gen.ts:
  // the charts checkout that holds plans.yaml is not in the build context. The drift gate (check-stripe-tiers-fresh.mjs) keeps
  // workstation regens honest; the file is tracked in git so the committed
  // state is the source of truth at deploy time. Mirrors SKIP_GEN_PLANS=1
  // in gen-plans.mjs.
  if (!stdoutMode && process.env.SKIP_GEN_STRIPE_TIERS === "1" && existsSync(OUTPUT)) {
    process.stdout.write(
      `gen-stripe-tiers: SKIP_GEN_STRIPE_TIERS=1, using pre-generated ${OUTPUT}\n`,
    );
    return;
  }

  let plansYaml;
  try {
    plansYaml = requireRepoPath(PLANS_REPO, PLANS_REL, { from: DASHBOARD_ROOT });
  } catch (e) {
    die(e.message);
  }
  const doc = parseYaml(readFileSync(plansYaml, "utf8"));
  if (!doc || !Array.isArray(doc.plans)) die("plans.yaml malformed");

  // BillingTier covers plans that get a Stripe price (not contact-sales).
  const billingPlans = doc.plans.filter((p) => p.pricing && !p.pricing.contactSales);
  const billingTiers = billingPlans.map((p) => p.id);

  if (billingTiers.length === 0) {
    die("plans.yaml has no Stripe-priced plans");
  }

  // Validate that every self-serve plan carries a lookupKey.
  for (const p of billingPlans) {
    if (!p.lookupKey || typeof p.lookupKey !== "string") {
      die(`plan "${p.id}" is missing a 'lookupKey' field. Add lookupKey: gibson_${p.id}_monthly_usd`);
    }
  }

  const lines = [];
  lines.push(
    // The stamped SPDX header is part of the artifact, so the generator emits
    // it. A stamping pass that adds it afterwards puts the committed file and
    // the generator's output permanently out of step, and the freshness gate
    // then fails on every workstation regen.
    "// SPDX-License-Identifier: Elastic-2.0",
    "// Copyright 2026 Zero Root AI",
    "",
    "// GENERATED FILE, do not edit.",
    "// Source: charts/helm/gibson-operators/files/plans.yaml",
    "// Generator: scripts/gen-stripe-tiers.mjs in zeroroot-ai/dashboard",
    "// Spec: plans-and-quotas-simplification R8.",
    "",
    "export type BillingTier =",
    ...billingTiers.map((id, i) => {
      const last = i === billingTiers.length - 1 ? ";" : "";
      return `  | ${JSON.stringify(id)}${last}`;
    }),
    "",
    "export const BILLING_TIER_IDS: readonly BillingTier[] = Object.freeze([",
    ...billingTiers.map((id) => `  ${JSON.stringify(id)},`),
    "]) as readonly BillingTier[];",
    "",
    "// LOOKUP_KEY_MAP maps each self-serve tier to its stable Stripe lookup_key.",
    "// Lookup keys are identical across every Stripe account and test/live mode,",
    "// so no per-environment STRIPE_PRICE_* env vars are needed. The dashboard",
    "// resolves the live price ID at runtime via prices.list({lookup_keys:[...]}).",
    "export const LOOKUP_KEY_MAP: Readonly<Record<BillingTier, string>> = Object.freeze({",
    ...billingPlans.map((p) => `  ${JSON.stringify(p.id)}: ${JSON.stringify(p.lookupKey)},`),
    "});",
    "",
    "// CONTACT_SALES_TIERS is the closed set of plan ids that route to a",
    "// contact-sales form rather than a Stripe checkout. Generated from",
    "// plans.yaml entries where pricing.contactSales === true.",
    "export const CONTACT_SALES_TIERS: readonly string[] = Object.freeze([",
    ...doc.plans.filter((p) => p.pricing && p.pricing.contactSales).map((p) => `  ${JSON.stringify(p.id)},`),
    "]) as readonly string[];",
    "",
  );
  const out = lines.join("\n");
  if (stdoutMode) {
    process.stdout.write(out);
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, out, "utf8");
  process.stdout.write(`gen-stripe-tiers: wrote ${OUTPUT} (${billingTiers.length} billing tiers)\n`);
}

main();
