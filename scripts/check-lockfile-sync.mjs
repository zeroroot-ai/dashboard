#!/usr/bin/env node
/**
 * check-lockfile-sync.mjs — keep the dashboard's two lockfiles honest.
 *
 * The dashboard intentionally ships BOTH lockfiles (see
 * docs/build-and-lockfiles.md):
 *   - pnpm-lock.yaml      — the dev source of truth (`pnpm install`), the only
 *                           lockfile that honors `pnpm.patchedDependencies`.
 *   - package-lock.json   — consumed by the production container image build
 *                           (`npm ci`, see Dockerfile).
 *
 * That duality has bitten before: a dependency bumped in one lockfile but not
 * the other means the dev build and the image build resolve different code.
 * This gate fails CI when the two lockfiles disagree on the resolved version
 * of any DIRECT dependency or devDependency declared in package.json.
 *
 * Scope is deliberately the direct-dependency closure, not the full transitive
 * tree: pnpm and npm legitimately differ on peer-dependency dedupe and hoisting
 * layout, so a byte-for-byte transitive comparison would be all false
 * positives. Direct deps are where an out-of-sync `pnpm add` / `npm install`
 * actually diverges the two build paths.
 *
 * Two modes:
 *   - strict (default)  — drift exits 1 (the eventual blocking gate).
 *   - --report          — drift is printed loudly but exits 0. Used in the
 *                         prebuild chain TODAY because the two lockfiles ship
 *                         with a pre-existing 38-direct-dep version skew (the
 *                         dev pnpm tree vs the image npm tree resolved
 *                         different patches of react/@tiptap/fumadocs/etc.).
 *                         Converging that skew is a full dual-lockfile
 *                         re-resolution tracked as a scoped follow-up; until it
 *                         lands, this gate runs in --report mode so every build
 *                         log surfaces the drift without blocking. Flip the
 *                         prebuild invocation to strict (drop --report) when the
 *                         follow-up converges the lockfiles. See
 *                         docs/build-and-lockfiles.md.
 *
 * There is intentionally NO `--skip` flag. The one place the check does not run
 * is the Docker image build, where `pnpm-lock.yaml` is excluded from the build
 * context (.dockerignore); there the check SKIPs cleanly (nothing to compare),
 * the same way the other sibling-dependent prebuild checks SKIP in the image.
 *
 * Usage:
 *   node scripts/check-lockfile-sync.mjs            # strict: drift exits 1
 *   node scripts/check-lockfile-sync.mjs --report   # drift warns, exits 0
 *   node scripts/check-lockfile-sync.mjs --selftest  # verify the checker logic
 *
 * Exit codes: 0 in sync (or --report), 1 drift found in strict mode (or selftest failure).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** Minimal YAML-ish extractor for the pnpm-lock.yaml `importers['.']` block. */
function pnpmDirectVersions(lockText) {
  const versions = new Map();
  const lines = lockText.split("\n");
  // Find `importers:` then the root importer `.:` then its
  // `dependencies:` / `devDependencies:` / `optionalDependencies:` maps.
  let inImporters = false;
  let inRootImporter = false;
  let inDepMap = false;
  let pendingName = null;
  for (const line of lines) {
    if (/^importers:\s*$/.test(line)) {
      inImporters = true;
      continue;
    }
    if (inImporters && /^\S/.test(line) && !/^importers:/.test(line)) {
      // Left the importers block entirely (a new top-level key).
      break;
    }
    if (!inImporters) continue;

    if (/^ {2}\.:\s*$/.test(line)) {
      inRootImporter = true;
      inDepMap = false;
      continue;
    }
    if (inRootImporter && /^ {2}\S/.test(line)) {
      // A different importer (a sub-package) started; root is done.
      break;
    }
    if (!inRootImporter) continue;

    if (/^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.test(line)) {
      inDepMap = true;
      pendingName = null;
      continue;
    }
    if (inDepMap && /^ {4}\S/.test(line)) {
      // Left the dep map (e.g. another section at 4-space indent).
      inDepMap = false;
    }
    if (!inDepMap) continue;

    // Entry name line: `      <name>:` at 6-space indent.
    const nameMatch = line.match(/^ {6}('[^']+'|[^:\s][^:]*):\s*$/);
    if (nameMatch) {
      pendingName = nameMatch[1].replace(/^'|'$/g, "");
      continue;
    }
    // `version: <ver>` child line under the entry (8-space indent).
    const verMatch = line.match(/^ {8}version:\s*(.+?)\s*$/);
    if (verMatch && pendingName) {
      // Strip pnpm peer-suffix, e.g. "1.2.3(react@19.0.0)" -> "1.2.3".
      const raw = verMatch[1].replace(/^'|'$/g, "");
      const clean = raw.replace(/\(.*\)$/, "");
      versions.set(pendingName, clean);
      pendingName = null;
    }
  }
  return versions;
}

/** Resolved versions for the root package's direct deps from package-lock.json. */
function npmDirectVersions(lockJson, directNames) {
  const versions = new Map();
  const pkgs = lockJson.packages || {};
  for (const name of directNames) {
    const node = pkgs[`node_modules/${name}`];
    if (node && node.version) versions.set(name, node.version);
  }
  return versions;
}

function directDepNames(pkgJson) {
  return new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {}),
    ...Object.keys(pkgJson.optionalDependencies || {}),
  ]);
}

function compare(names, pnpmVersions, npmVersions) {
  const drift = [];
  for (const name of names) {
    const p = pnpmVersions.get(name);
    const n = npmVersions.get(name);
    if (!p || !n) continue; // one lockfile may legitimately omit (e.g. workspace-only); not a drift signal
    if (p !== n) drift.push({ name, pnpm: p, npm: n });
  }
  return drift;
}

function run() {
  const pkgPath = join(ROOT, "package.json");
  const pnpmPath = join(ROOT, "pnpm-lock.yaml");
  const npmPath = join(ROOT, "package-lock.json");

  // pnpm-lock.yaml is deliberately excluded from the Docker build context
  // (.dockerignore — Next.js 16's pnpm-patch path fails when it leaks in), so
  // it is absent inside the image build. This is a HOST-only cross-lockfile
  // check; when the pnpm lockfile is not present there is nothing to compare
  // against, so skip cleanly rather than fail (same pattern as the other
  // sibling-dependent prebuild checks that SKIP in the image build).
  if (!existsSync(pnpmPath)) {
    console.log(
      "[check-lockfile-sync] SKIPPED — pnpm-lock.yaml not present (image build / npm-only context); the host build runs the full cross-lockfile check."
    );
    return;
  }

  for (const [label, p] of [
    ["package.json", pkgPath],
    ["package-lock.json", npmPath],
  ]) {
    if (!existsSync(p)) {
      console.error(`[check-lockfile-sync] FAIL — ${label} not found at ${p}`);
      process.exit(1);
    }
  }

  const pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));
  const names = directDepNames(pkgJson);
  const pnpmVersions = pnpmDirectVersions(readFileSync(pnpmPath, "utf8"));
  const npmVersions = npmDirectVersions(JSON.parse(readFileSync(npmPath, "utf8")), names);

  // Sanity: if we parsed nothing out of pnpm-lock, the extractor is broken —
  // fail loud rather than passing vacuously.
  if (pnpmVersions.size === 0) {
    console.error(
      "[check-lockfile-sync] FAIL — parsed zero direct deps from pnpm-lock.yaml; the extractor is out of date with the lockfile format."
    );
    process.exit(1);
  }

  const report = process.argv.includes("--report");
  const drift = compare(names, pnpmVersions, npmVersions);
  if (drift.length > 0) {
    const label = report ? "WARN" : "FAIL";
    console.error(
      `[check-lockfile-sync] ${label} — pnpm-lock.yaml and package-lock.json disagree on ${drift.length} direct dependency version(s):`
    );
    for (const d of drift) {
      console.error(`  ${d.name}: pnpm=${d.pnpm}  npm=${d.npm}`);
    }
    console.error(
      "\nFix: re-run BOTH lockfile generators after a dependency change —\n" +
        "  pnpm install            (updates pnpm-lock.yaml)\n" +
        "  npm install --package-lock-only --ignore-scripts --legacy-peer-deps\n" +
        "and commit both. See docs/build-and-lockfiles.md."
    );
    if (!report) process.exit(1);
    console.error(
      "\n[check-lockfile-sync] running in --report mode; the pre-existing skew is\n" +
        "tracked as a scoped follow-up and does not block this build."
    );
    return;
  }

  console.log(
    `[check-lockfile-sync] OK — ${drift.length === 0 ? "all" : ""} direct deps agree across both lockfiles ` +
      `(${names.size} declared, ${[...names].filter((n) => pnpmVersions.has(n) && npmVersions.has(n)).length} cross-checked).`
  );
}

function selftest() {
  const names = new Set(["a", "b", "c"]);
  const pnpm = new Map([
    ["a", "1.0.0"],
    ["b", "2.0.0"],
    ["c", "3.0.0"],
  ]);
  const npmOk = new Map([
    ["a", "1.0.0"],
    ["b", "2.0.0"],
    ["c", "3.0.0"],
  ]);
  const npmDrift = new Map([
    ["a", "1.0.0"],
    ["b", "2.5.0"], // drift
    ["c", "3.0.0"],
  ]);

  const clean = compare(names, pnpm, npmOk);
  const dirty = compare(names, pnpm, npmDrift);

  // Peer-suffix stripping check on the pnpm extractor.
  const stripped = pnpmDirectVersions(
    [
      "importers:",
      "  .:",
      "    dependencies:",
      "      next:",
      "        specifier: 16.2.6",
      "        version: 16.2.6(react@19.0.0)",
      "    devDependencies:",
      "      knip:",
      "        specifier: ^5",
      "        version: 5.88.1",
      "  some/sub:",
      "    dependencies:",
      "      ignored:",
      "        version: 9.9.9",
    ].join("\n")
  );

  const failures = [];
  if (clean.length !== 0) failures.push("expected no drift for matching maps");
  if (dirty.length !== 1 || dirty[0].name !== "b") failures.push("expected exactly one drift on 'b'");
  if (stripped.get("next") !== "16.2.6") failures.push("peer-suffix not stripped from pnpm version");
  if (stripped.get("knip") !== "5.88.1") failures.push("plain pnpm version not parsed");
  if (stripped.has("ignored")) failures.push("sub-importer deps leaked into root extraction");

  if (failures.length > 0) {
    console.error("[check-lockfile-sync] SELFTEST FAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("[check-lockfile-sync] SELFTEST OK");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  run();
}
