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
 * The generated file contains strongly-typed Plan / Quotas / Features / PlanID
 * definitions + the frozen `plans` constant used by /pricing, BillingContent,
 * and tier-checker. This script is the single bridge between the Go operator's
 * source of truth and the dashboard; no other TS file should parse the YAML
 * directly.
 *
 * Runs in the `prebuild` npm hook. Exits with a non-zero status on any failure
 * so the build fails loudly rather than producing stale types.
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

const KNOWN_PLAN_IDS = [
  "solo",
  "squad",
  "org",
  "platform",
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
];

const REQUIRED_QUOTA_KEYS = [
  "seats",
  "concurrent_agents",
  "storage_gb",
  "retention_days",
  "sandbox_launches_per_month",
];

const REQUIRED_FEATURE_KEYS = [
  "has_sso",
  "has_audit_logs",
  "has_compliance_exports",
  "has_dedicated_slack",
  "has_dedicated_tenant",
  "has_private_registry",
];

function die(msg) {
  process.stderr.write(`gen-plans: ${msg}\n`);
  process.exit(1);
}

function main() {
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
    for (const f of ["displayName", "tagline", "persona"]) {
      if (!plan[f]) die(`plan[${plan.id}]: missing ${f}`);
    }
    if (typeof plan.contactOnly !== "boolean") {
      die(`plan[${plan.id}]: contactOnly must be boolean`);
    }
    if (!plan.quotas || typeof plan.quotas !== "object") {
      die(`plan[${plan.id}]: quotas missing`);
    }
    for (const k of REQUIRED_QUOTA_KEYS) {
      if (!Number.isInteger(plan.quotas[k])) {
        die(`plan[${plan.id}]: quotas.${k} must be an integer`);
      }
      if (plan.quotas[k] < -1) {
        die(`plan[${plan.id}]: quotas.${k} must be >= -1`);
      }
    }
    if (!plan.features || typeof plan.features !== "object") {
      die(`plan[${plan.id}]: features missing`);
    }
    for (const k of REQUIRED_FEATURE_KEYS) {
      if (typeof plan.features[k] !== "boolean") {
        die(`plan[${plan.id}]: features.${k} must be boolean`);
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
    "  /** Seat count; -1 = unlimited. */",
    "  seats: number;",
    "  /** Max concurrent agents; -1 = unlimited. */",
    "  concurrent_agents: number;",
    "  /** GraphRAG/workspace storage in gigabytes; -1 = unlimited. */",
    "  storage_gb: number;",
    "  /** Audit/mission-history retention window; -1 = unlimited. */",
    "  retention_days: number;",
    "  /** Setec microVM launches per month; -1 = unlimited / fair-use. */",
    "  sandbox_launches_per_month: number;",
    "}",
    "",
    "export interface Features {",
    "  has_sso: boolean;",
    "  has_audit_logs: boolean;",
    "  has_compliance_exports: boolean;",
    "  has_dedicated_slack: boolean;",
    "  has_dedicated_tenant: boolean;",
    "  has_private_registry: boolean;",
    "}",
    "",
    "export interface CTA {",
    "  label?: string;",
    "  href?: string;",
    "  variant?: \"default\" | \"outline\" | \"secondary\";",
    "}",
    "",
    "export interface Plan {",
    "  id: PlanID;",
    "  displayName: string;",
    "  tagline: string;",
    "  persona: string;",
    "  stripeProductId: string | null;",
    "  monthlyPrice: number | null;",
    "  annualPrice: number | null;",
    "  contactOnly: boolean;",
    "  annualSavingsPct: number | null;",
    "  quotas: Quotas;",
    "  features: Features;",
    "  deployment?: string;",
    "  responseSla?: string;",
    "  includedSeatsDisplay?: string;",
    "  perSeatBase?: number | null;",
    "  perSeatOverage?: number | null;",
    "  additionalNotes?: string[];",
    "  isMostPopular?: boolean;",
    "  cta?: CTA;",
    "}",
    "",
    `export const PLAN_REGISTRY_VERSION = ${JSON.stringify(doc.version)};`,
    "",
    "export const plans: readonly Plan[] = Object.freeze([",
    ...doc.plans.map((p) => "  " + jsonToTsLiteral(p) + ","),
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
    "export function featureTupleSet(id: PlanID, tenantName: string): string[] {",
    "  if (!tenantName) return [];",
    "  const f = lookupPlan(id).features;",
    "  const prefix = `tenant:${tenantName}#has_`;",
    "  const suffix = `@tenant:${tenantName}`;",
    "  const out: string[] = [];",
    "  if (f.has_sso) out.push(prefix + \"sso\" + suffix);",
    "  if (f.has_audit_logs) out.push(prefix + \"audit_logs\" + suffix);",
    "  if (f.has_compliance_exports) out.push(prefix + \"compliance_exports\" + suffix);",
    "  if (f.has_dedicated_slack) out.push(prefix + \"dedicated_slack\" + suffix);",
    "  if (f.has_dedicated_tenant) out.push(prefix + \"dedicated_tenant\" + suffix);",
    "  if (f.has_private_registry) out.push(prefix + \"private_registry\" + suffix);",
    "  return out.sort();",
    "}",
    "",
  );
  return lines.join("\n");
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
