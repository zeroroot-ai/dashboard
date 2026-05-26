#!/usr/bin/env node
/**
 * vendor-mission-authoring-bundle — pulls the mission-authoring
 * OCI artifact (published by opensource/sdk's
 * publish-mission-authoring.yml workflow) into local
 * src/data/ and src/app/dashboard/(auth)/docs/ at build time.
 *
 * Bundle layout (produced by `make mission-authoring-bundle` in
 * opensource/sdk):
 *
 *   mission-authoring-bundle.tar.gz
 *     ├── mission-definition.schema.json
 *     ├── glossary.json
 *     └── docs/
 *         ├── verbs.mdx
 *         ├── nouns.mdx
 *         ├── schema-ref.mdx
 *         └── templates.mdx
 *
 * Where the dashboard places the artifacts:
 *
 *   src/data/mission-definition.schema.json    (Monaco YAML schema)
 *   src/data/glossary.json                     (GlossaryProvider)
 *   src/data/mission-authoring-version.json    (build metadata)
 *   src/app/dashboard/(auth)/docs/{verbs,nouns,schema-reference,templates}.mdx
 *
 * Resolution order for the bundle source:
 *
 *   1. `MISSION_AUTHORING_BUNDLE_PATH` env var — local tarball path
 *      (used by tests, dev, and CI to skip the OCI pull).
 *   2. `MISSION_AUTHORING_BUNDLE_DIR` env var — pre-extracted dir.
 *   3. Sibling SDK checkout at $WORKSPACE_ROOT/opensource/sdk/gen —
 *      used by developers in the canonical polyrepo layout. Falls
 *      back to this when no env var is set, before attempting the
 *      OCI pull.
 *   4. `oras pull ghcr.io/zeroroot-ai/mission-authoring:${MISSION_AUTHORING_VERSION}`.
 *
 * MISSION_AUTHORING_VERSION defaults to the SDK version pinned in
 * the sibling gibson repo's go.mod (resolved via `go list -m`).
 *
 * Worktree-aware: when run from .worktrees/<name>/scripts/, the
 * naive `../../..` walk lands short of the workspace root. Strip
 * the `.worktrees/<name>` suffix to recover the canonical
 * dashboard root before walking up (same pattern as
 * scripts/gen-plans.mjs, gen-mission-schema.mjs,
 * check-mission-schema-fresh.mjs, proto-generate.mjs).
 *
 * Spec: mission-dashboard-rewrite Requirement 4.1 + 5.3 + 6.1.
 */

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(HERE, '..');
// Worktree-aware: when DASHBOARD_ROOT is .worktrees/<name>/ the naive
// `../../..` walk lands short of the workspace root. Rewind to the main
// checkout root before walking up. dashboard#193 (matches the pattern
// landed in #162 / #175 / PR-for-#186).
const isWorktree = DASHBOARD_ROOT.includes('/.worktrees/');
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.worktrees\/[^/]+$/, '')
  : DASHBOARD_ROOT;
const WORKSPACE_ROOT = path.resolve(MAIN_DASHBOARD_ROOT, '..', '..', '..');

const SRC_DATA = path.join(DASHBOARD_ROOT, 'src/data');
const DOCS_ROUTE = path.join(
  DASHBOARD_ROOT,
  'src/app/dashboard/(auth)/docs',
);

function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    cwd: opts.cwd ?? DASHBOARD_ROOT,
    stdio: opts.stdio ?? 'pipe',
  });
}

function resolveBundleSourceDir() {
  // 1. Explicit pre-extracted directory.
  const dirOverride = process.env.MISSION_AUTHORING_BUNDLE_DIR;
  if (dirOverride) {
    if (!existsSync(dirOverride)) {
      throw new Error(
        `MISSION_AUTHORING_BUNDLE_DIR=${dirOverride} does not exist`,
      );
    }
    console.log(`mission-authoring-bundle: using dir override ${dirOverride}`);
    return { dir: dirOverride, version: 'override' };
  }

  // 2. Tarball override — extract to .tmp/ and return.
  const tarOverride = process.env.MISSION_AUTHORING_BUNDLE_PATH;
  if (tarOverride) {
    return extractTarball(tarOverride, 'tarball-override');
  }

  // 3. Sibling SDK checkout.
  const siblingGen = path.join(WORKSPACE_ROOT, 'opensource/sdk/gen');
  if (
    existsSync(path.join(siblingGen, 'mission-definition.schema.json')) &&
    existsSync(path.join(siblingGen, 'mission-docs'))
  ) {
    console.log(
      `mission-authoring-bundle: using sibling SDK gen/ at ${siblingGen}`,
    );
    return { dir: siblingGen, version: 'sibling-checkout' };
  }

  // 4. OCI pull.
  const version = resolveVersion();
  const pullDir = path.join(DASHBOARD_ROOT, '.tmp/mission-authoring-pull');
  rmSync(pullDir, { recursive: true, force: true });
  mkdirSync(pullDir, { recursive: true });

  const ref = `ghcr.io/zeroroot-ai/mission-authoring:${version}`;
  console.log(`mission-authoring-bundle: oras pull ${ref}`);
  try {
    run(`oras pull ${ref}`, { cwd: pullDir, stdio: 'inherit' });
  } catch (err) {
    throw new Error(
      `oras pull failed for ${ref}. Set MISSION_AUTHORING_BUNDLE_DIR or MISSION_AUTHORING_BUNDLE_PATH to skip the OCI pull. Underlying: ${err.message ?? err}`,
    );
  }

  const tarball = path.join(pullDir, 'mission-authoring-bundle.tar.gz');
  if (!existsSync(tarball)) {
    throw new Error(
      `oras pull succeeded but ${tarball} is missing — bundle layout drift`,
    );
  }
  return extractTarball(tarball, version);
}

function extractTarball(tarballPath, version) {
  const dest = path.join(DASHBOARD_ROOT, '.tmp/mission-authoring-extract');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run(`tar -xzf ${tarballPath} -C ${dest}`);
  return { dir: dest, version };
}

function resolveVersion() {
  const explicit = process.env.MISSION_AUTHORING_VERSION;
  if (explicit) return explicit;

  // Resolve from sibling gibson's go.mod via `go list -m`.
  const gibsonRepo = path.join(WORKSPACE_ROOT, 'enterprise/platform/gibson');
  if (existsSync(path.join(gibsonRepo, 'go.mod'))) {
    try {
      const v = run(
        'go list -m -f "{{.Version}}" github.com/zeroroot-ai/sdk',
        { cwd: gibsonRepo },
      ).trim();
      if (v) return v;
    } catch {
      // fall through
    }
  }

  throw new Error(
    'cannot resolve MISSION_AUTHORING_VERSION; set it explicitly or run from the canonical polyrepo workspace',
  );
}

function copyArtifacts(sourceDir, version) {
  mkdirSync(SRC_DATA, { recursive: true });
  mkdirSync(DOCS_ROUTE, { recursive: true });

  const schemaSrc = path.join(sourceDir, 'mission-definition.schema.json');
  if (!existsSync(schemaSrc)) {
    throw new Error(`bundle missing mission-definition.schema.json (looked at ${schemaSrc})`);
  }
  cpSync(schemaSrc, path.join(SRC_DATA, 'mission-definition.schema.json'));

  const glossarySrc = path.join(sourceDir, 'glossary.json');
  if (existsSync(glossarySrc)) {
    cpSync(glossarySrc, path.join(SRC_DATA, 'glossary.json'));
  } else {
    // glossary.json may be inside mission-docs/ in the sibling-checkout layout.
    const altGlossary = path.join(sourceDir, 'mission-docs/glossary.json');
    if (existsSync(altGlossary)) {
      cpSync(altGlossary, path.join(SRC_DATA, 'glossary.json'));
    }
  }

  const docsSrc = pickDocsDir(sourceDir);
  if (docsSrc) {
    for (const [bundleName, dashboardName] of [
      ['verbs.mdx', 'verbs.mdx'],
      ['nouns.mdx', 'nouns.mdx'],
      ['schema-ref.mdx', 'schema-reference.mdx'],
      ['templates.mdx', 'templates.mdx'],
    ]) {
      const src = path.join(docsSrc, bundleName);
      if (!existsSync(src)) continue;
      cpSync(src, path.join(DOCS_ROUTE, dashboardName));
    }
  }

  // Build metadata for the version-mismatch banner.
  writeFileSync(
    path.join(SRC_DATA, 'mission-authoring-version.json'),
    `${JSON.stringify({ version, vendoredAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function pickDocsDir(root) {
  const candidates = [
    path.join(root, 'docs'),
    path.join(root, 'mission-docs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function main() {
  console.log('mission-authoring-bundle: vendoring bundle artifacts...');
  const { dir, version } = resolveBundleSourceDir();
  copyArtifacts(dir, version);
  console.log(
    `mission-authoring-bundle: vendored version=${version} into src/data/ + docs route`,
  );
  // Verify the headline artifact landed.
  const probe = path.join(SRC_DATA, 'mission-definition.schema.json');
  const stat = readFileSync(probe);
  if (!stat.length) {
    throw new Error(`vendored ${probe} is empty`);
  }
}

main();
