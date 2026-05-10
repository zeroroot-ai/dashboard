#!/usr/bin/env node
/**
 * gen-plans.mjs — canonical plan registry → TypeScript emitter.
 *
 * Reads:
 *   enterprise/platform/tenant-operator/plans/plans.yaml
 *   enterprise/platform/tenant-operator/plans/plans.schema.json
 *
 * Emits:
 *   enterprise/platform/dashboard/src/generated/plans.ts
 *
 * The generated file contains strongly-typed Plan / Quotas / Pricing / PlanID
 * definitions + the frozen `plans` constant used by /pricing, BillingContent,
 * and tier-checker. This script is the single bridge between the Go operator's
 * source of truth and the dashboard; no other TS file should parse the YAML
 * directly.
 *
 * Runs in the `prebuild` npm hook. Exits with a non-zero status on any failure
 * so the build fails loudly rather than producing stale types.
 *
 * Schema simplified by spec plans-and-quotas-simplification:
 *   - Four plan ids: team, org, enterprise, enterprise-deploy
 *   - Two quotas: concurrent_missions, concurrent_agents (0 = unlimited)
 *   - Pricing block carries display metadata
 *   - No more Features / has_* flags
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
const PLANS_SCHEMA = resolve(
  REPO_ROOT,
  "enterprise/platform/tenant-operator/plans/plans.schema.json",
);
const OUTPUT = resolve(DASHBOARD_ROOT, "src/generated/plans.ts");

const KNOWN_PLAN_IDS = ["team", "org", "enterprise", "enterprise-deploy"];

const REQUIRED_QUOTA_KEYS = ["concurrent_missions", "concurrent_agents"];

function die(msg) {
  process.stderr.write(`gen-plans: ${msg}\n`);
  process.exit(1);
}

function main() {
  const stdoutMode = process.argv.slice(2).includes("--stdout");

  if (!stdoutMode && process.env.SKIP_GEN_PLANS === "1" && existsSync(OUTPUT)) {
    process.stdout.write(
      `gen-plans: SKIP_GEN_PLANS=1 — using pre-generated ${OUTPUT}\n`,
    );
    return;
  }
  if (!existsSync(PLANS_YAML)) {
    die(`plans.yaml not found at ${PLANS_YAML}`);
  }
  if (!existsSync(PLANS_SCHEMA)) {
    die(`plans.schema.json not found at ${PLANS_SCHEMA}`);
  }

  const yamlText = readFileSync(PLANS_YAML, "utf8");
  let doc;
  try {
    doc = parseYaml(yamlText);
  } catch (e) {
    die(`parse plans.yaml: ${e.message}`);
  }

  validate(doc);

  const ts = renderTypeScript(doc);
  if (stdoutMode) {
    process.stdout.write(ts);
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, ts, "utf8");
  process.stdout.write(`gen-plans: wrote ${OUTPUT} (${doc.plans.length} plans)\n`);
}

function validate(doc) {
  if (!doc || typeof doc !== "object") {
    die("plans.yaml did not parse to an object");
  }
  if (doc.version !== "v1") {
    die(`unsupported registry version: ${doc.version}`);
  }
  if (!Array.isArray(doc.plans) || doc.plans.length === 0) {
    die("plans.yaml must contain a non-empty plans[] array");
  }
  const seen = new Set();
  for (const [i, plan] of doc.plans.entries()) {
    if (!plan.id) die(`plan[${i}]: missing id`);
    if (!KNOWN_PLAN_IDS.includes(plan.id)) {
      die(`plan[${i}]: unknown id ${JSON.stringify(plan.id)}`);
    }
    if (seen.has(plan.id)) die(`plan id ${plan.id} defined more than once`);
    seen.add(plan.id);
    for (const f of ["displayName", "tagline"]) {
      if (!plan[f]) die(`plan[${plan.id}]: missing ${f}`);
    }
    if (!plan.pricing || typeof plan.pricing !== "object") {
      die(`plan[${plan.id}]: pricing missing`);
    }
    const hasPrice =
      typeof plan.pricing.monthlyUSD === "number" ||
      typeof plan.pricing.annualUSD === "number" ||
      plan.pricing.contactSales === true;
    if (!hasPrice) {
      die(
        `plan[${plan.id}]: pricing must set at least one of monthlyUSD, annualUSD, or contactSales=true`,
      );
    }
    if (!plan.quotas || typeof plan.quotas !== "object") {
      die(`plan[${plan.id}]: quotas missing`);
    }
    for (const k of REQUIRED_QUOTA_KEYS) {
      if (!Number.isInteger(plan.quotas[k])) {
        die(`plan[${plan.id}]: quotas.${k} must be an integer`);
      }
      if (plan.quotas[k] < 0) {
        die(`plan[${plan.id}]: quotas.${k} must be >= 0 (0 = unlimited)`);
      }
    }
  }
}

function renderTypeScript(doc) {
  const lines = [];
  lines.push(
    "// GENERATED FILE — do not edit.",
    "// Source: enterprise/platform/tenant-operator/plans/plans.yaml",
    "// Generator: enterprise/platform/dashboard/scripts/gen-plans.mjs",
    "// Run `npm run build` (or the `prebuild` hook) to regenerate.",
    "",
    "export type PlanID =",
    ...KNOWN_PLAN_IDS.map((id, i) => {
      const last = i === KNOWN_PLAN_IDS.length - 1 ? ";" : "";
      return `  | ${JSON.stringify(id)}${last}`;
    }),
    "",
    "export interface Quotas {",
    "  /** Max concurrent (in-flight) missions; 0 = unlimited. */",
    "  concurrent_missions: number;",
    "  /** Max concurrent agents bound to in-flight tasks; 0 = unlimited.",
    "   *  Idle-but-connected agents do NOT count toward this quota. */",
    "  concurrent_agents: number;",
    "}",
    "",
    "export interface Pricing {",
    "  monthlyUSD?: number;",
    "  annualUSD?: number;",
    "  annualSavingsPct?: number;",
    "  contactSales?: boolean;",
    "}",
    "",
    "export interface Plan {",
    "  id: PlanID;",
    "  displayName: string;",
    "  tagline: string;",
    "  stripeProductId: string | null;",
    "  pricing: Pricing;",
    "  quotas: Quotas;",
    "}",
    "",
    `export const PLAN_REGISTRY_VERSION = ${JSON.stringify(doc.version)};`,
    "",
    "export const plans: readonly Plan[] = Object.freeze([",
    ...doc.plans.map((p) => "  " + jsonToTsLiteral(normalisePlan(p)) + ","),
    "]);",
    "",
    `export const planIDs: readonly PlanID[] = Object.freeze([${KNOWN_PLAN_IDS.map(
      (id) => JSON.stringify(id),
    ).join(", ")}]) as readonly PlanID[];`,
    "",
    "const byID: Readonly<Record<PlanID, Plan>> = Object.freeze(",
    "  Object.fromEntries(plans.map((p) => [p.id, p])) as Record<PlanID, Plan>,",
    ");",
    "",
    "export function lookupPlan(id: PlanID): Plan {",
    "  const p = byID[id];",
    "  if (!p) throw new Error(`unknown plan id: ${id}`);",
    "  return p;",
    "}",
    "",
  );
  return lines.join("\n");
}

/**
 * normalisePlan strips any YAML keys not part of the Plan TS interface and
 * fills in `stripeProductId: null` when omitted, so the generated literal
 * matches the type exactly.
 */
function normalisePlan(p) {
  return {
    id: p.id,
    displayName: p.displayName,
    tagline: p.tagline,
    stripeProductId: p.stripeProductId ?? null,
    pricing: {
      ...(typeof p.pricing.monthlyUSD === "number" ? { monthlyUSD: p.pricing.monthlyUSD } : {}),
      ...(typeof p.pricing.annualUSD === "number" ? { annualUSD: p.pricing.annualUSD } : {}),
      ...(typeof p.pricing.annualSavingsPct === "number" ? { annualSavingsPct: p.pricing.annualSavingsPct } : {}),
      ...(p.pricing.contactSales === true ? { contactSales: true } : {}),
    },
    quotas: {
      concurrent_missions: p.quotas.concurrent_missions,
      concurrent_agents: p.quotas.concurrent_agents,
    },
  };
}

/**
 * jsonToTsLiteral serialises a plan object as a TS object-literal string.
 * Using JSON.stringify produces valid TS because all values are JSON-safe
 * (no Dates, no undefined keys after null-normalisation).
 */
function jsonToTsLiteral(obj) {
  return JSON.stringify(obj, null, 2).replace(/\n/g, "\n  ");
}

main();
