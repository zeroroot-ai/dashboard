#!/usr/bin/env node
/**
 * gen-stripe-tiers.mjs — emits src/lib/billing/stripe_gen.ts from
 * plans.yaml. Single bridge between the operator's plan registry and the
 * dashboard's BillingTier union + PRICE_ENV_MAP. Spec
 * plans-and-quotas-simplification R8 / R3.1.
 *
 * The generated file carries:
 *   - BillingTier   : TS union of every plan id whose pricing has
 *                     stripeProductId support (i.e. NOT contactSales-only).
 *   - PRICE_ENV_MAP : { [tier]: STRIPE_PRICE_<TIER_SLUG> } — the env-var
 *                     names required at runtime when paid tiers are enabled.
 *
 * stripe.ts imports these and keeps the runtime helpers (priceIdForTier /
 * validateBillingConfig). Drift is caught by check-stripe-tiers-fresh.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..", "..", "..");
const PLANS_YAML = resolve(
  REPO_ROOT,
  "enterprise/platform/tenant-operator/plans/plans.yaml",
);
const OUTPUT = resolve(DASHBOARD_ROOT, "src/lib/billing/stripe_gen.ts");

function envSlug(id) {
  // team → STRIPE_PRICE_TEAM, enterprise-deploy → STRIPE_PRICE_ENTERPRISE_DEPLOY
  return "STRIPE_PRICE_" + id.toUpperCase().replace(/-/g, "_");
}

function die(msg) {
  process.stderr.write(`gen-stripe-tiers: ${msg}\n`);
  process.exit(1);
}

function main() {
  const stdoutMode = process.argv.slice(2).includes("--stdout");
  if (!existsSync(PLANS_YAML)) die(`plans.yaml not found at ${PLANS_YAML}`);
  const doc = parseYaml(readFileSync(PLANS_YAML, "utf8"));
  if (!doc || !Array.isArray(doc.plans)) die("plans.yaml malformed");

  // BillingTier covers plans that get a Stripe price (not contact-sales).
  const billingTiers = doc.plans
    .filter((p) => p.pricing && !p.pricing.contactSales)
    .map((p) => p.id);

  if (billingTiers.length === 0) {
    die("plans.yaml has no Stripe-priced plans");
  }

  const lines = [];
  lines.push(
    "// GENERATED FILE — do not edit.",
    "// Source: enterprise/platform/tenant-operator/plans/plans.yaml",
    "// Generator: enterprise/platform/dashboard/scripts/gen-stripe-tiers.mjs",
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
    "export const PRICE_ENV_MAP: Readonly<Record<BillingTier, string>> = Object.freeze({",
    ...billingTiers.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(envSlug(id))},`),
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
