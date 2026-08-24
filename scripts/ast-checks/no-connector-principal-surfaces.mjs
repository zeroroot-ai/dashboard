#!/usr/bin/env node
/**
 * Guard: no-connector-principal-surfaces
 *
 * ADR-0067: a connector has no principal, deliberately. It is only ever
 * the OBJECT of a grant (component:connector/<id>); the target principal
 * of every grant stays an agent / tool / plugin principal. Two surfaces
 * would silently break that model, and this guard keeps both absent:
 *
 *   1. A connector permissions page. No route directory under app/ may
 *      have a `permissions` segment anywhere below a `connectors`
 *      segment (e.g. app/dashboard/(auth)/connectors/[id]/permissions).
 *      Principal-side permissions tabs live on agents / tools only.
 *
 *   2. A CONNECTOR recipient class in the grants inspector. Capability
 *      grants (CG-JWTs) are minted to principals; files under
 *      src/components/grants/ must not reference a CONNECTOR recipient
 *      class or label a recipient "Connector".
 *
 * Both checks are keyed by content / path shape, never by line number.
 *
 * Run: node scripts/ast-checks/no-connector-principal-surfaces.mjs
 * Test fixture mode: node scripts/ast-checks/no-connector-principal-surfaces.mjs --fixtures
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "coverage",
  ".worktrees",
  ".claude",
  "playwright-report",
  "test-results",
]);

// A recipient-class reference to CONNECTOR, or a "Connector" recipient
// label, in the grants inspector.
const CONNECTOR_RECIPIENT_RE =
  /(?:RecipientClass|RC)\s*\.\s*CONNECTOR|['"]Connector['"]/;

function* walkDirs(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      yield full;
      yield* walkDirs(full);
    }
  }
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) yield* walkFiles(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

/**
 * True when a route path has a `permissions` segment anywhere below a
 * `connectors` segment.
 */
function isConnectorPermissionsRoute(relPath) {
  const segs = relPath.replace(/\\/g, "/").split("/");
  const connectorsIdx = segs.indexOf("connectors");
  if (connectorsIdx === -1) return false;
  return segs.slice(connectorsIdx + 1).includes("permissions");
}

function findRouteViolations(appRoot) {
  const findings = [];
  if (!existsSync(appRoot)) return findings;
  for (const dir of walkDirs(appRoot)) {
    const rel = relative(appRoot, dir);
    if (isConnectorPermissionsRoute(rel)) {
      findings.push(relative(REPO_ROOT, dir));
    }
  }
  return findings;
}

function findRecipientViolations(grantsRoot) {
  const findings = [];
  if (!existsSync(grantsRoot)) return findings;
  for (const file of walkFiles(grantsRoot)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (CONNECTOR_RECIPIENT_RE.test(lines[i])) {
        findings.push(`${relative(REPO_ROOT, file)}:${i + 1}`);
      }
    }
  }
  return findings;
}

async function runFixtures() {
  const fixturesDir = join(__dirname, "fixtures");
  let failures = 0;

  // Content check fixtures: connector-surfaces-grants-table.* under
  // legal/ must produce no findings, under illegal/ at least one.
  for (const kind of ["legal", "illegal"]) {
    const dir = join(fixturesDir, kind);
    const names = readdirSync(dir).filter((n) =>
      n.startsWith("connector-surfaces-grants-table"),
    );
    if (names.length === 0) {
      console.error(`fixture dir ${dir} missing connector-surfaces-grants-table file`);
      failures++;
      continue;
    }
    for (const name of names) {
      const src = readFileSync(join(dir, name), "utf8");
      const got = src
        .split("\n")
        .some((l) => CONNECTOR_RECIPIENT_RE.test(l));
      const expects = kind === "illegal";
      if (got !== expects) {
        console.error(
          `fixture ${kind}/${name} expected findings=${expects}, got=${got}`,
        );
        failures++;
      } else {
        console.log(`fixture ${kind}/${name} ✓`);
      }
    }
  }

  // Route check fixtures: a synthetic app tree per kind.
  for (const kind of ["legal", "illegal"]) {
    const appRoot = join(fixturesDir, kind, "connector-surfaces-app");
    if (!existsSync(appRoot)) {
      console.error(`fixture app tree missing: ${appRoot}`);
      failures++;
      continue;
    }
    const findings = findRouteViolations(appRoot);
    const expects = kind === "illegal";
    const got = findings.length > 0;
    if (got !== expects) {
      console.error(
        `fixture ${kind}/connector-surfaces-app expected findings=${expects}, got=${got}`,
      );
      failures++;
    } else {
      console.log(`fixture ${kind}/connector-surfaces-app ✓`);
    }
  }

  if (failures > 0) {
    console.error(`fixture suite: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("all fixtures passed");
}

async function run() {
  const routeFindings = findRouteViolations(join(REPO_ROOT, "app"));
  const recipientFindings = findRecipientViolations(
    join(REPO_ROOT, "src", "components", "grants"),
  );

  if (routeFindings.length > 0 || recipientFindings.length > 0) {
    console.error("no-connector-principal-surfaces: violations");
    for (const f of routeFindings) {
      console.error(`  route: ${f}  (connector permissions page)`);
    }
    for (const f of recipientFindings) {
      console.error(`  recipient class: ${f}  (CONNECTOR recipient in grants inspector)`);
    }
    console.error(
      "\nA connector has no principal (ADR-0067). Grant against " +
        "component:connector/<id> from the agent / tool Permissions tab " +
        "instead of adding a connector-side permissions surface.",
    );
    process.exit(1);
  }
  console.log("no-connector-principal-surfaces: ok");
}

if (process.argv.includes("--fixtures")) {
  await runFixtures();
} else {
  await run();
}
