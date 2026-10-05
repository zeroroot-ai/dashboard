#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * proto-generate, regenerate the dashboard's TypeScript proto bindings
 * from two sources:
 *
 *   1. The OSS SDK protos, from the Buf Schema Registry module
 *      `buf.build/zeroroot-ai/sdk` at the version `SDK_BSR_VERSION` below
 *      (ADR-0028: a consumer in a language other than Go reads the protos
 *      from the registry). No `sdk` checkout and no Go module cache is read,
 *      so the bindings do not depend on what is on the disk.
 *   2. The gibson daemon-local protos at `internal/server/daemon/api/` in a
 *      gibson checkout. They are not published anywhere.
 *
 * Buf v2 requires every module path in buf.yaml to resolve INSIDE the
 * directory containing buf.yaml. The daemon-local tree lives OUTSIDE the
 * dashboard repo. To make buf happy, this script synthesises a temporary
 * workspace at `.tmp/proto-ws/` *inside* the dashboard, puts a symlink to
 * the daemon-local tree in it, drops a generated buf.yaml + buf.gen.yaml
 * inside that workspace, runs `buf generate` from there, and rsyncs the
 * output back into `src/gen/`.
 *
 * To move to a new SDK release: change `SDK_BSR_VERSION`, run
 * `pnpm proto:generate`, and commit `src/gen/` with the change. Use the
 * version that the `go.mod` of gibson pins, so that the two proto trees agree.
 *
 * **Workstation-only:** this script needs a gibson checkout that the
 * resolver can reach, and network access to the Buf Schema Registry. CI does
 * not regenerate proto bindings, `src/gen/` is committed and CI just
 * typechecks it.
 *
 * Spec: component-bootstrap-dashboard-completion (proto-gen workflow).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRepoPath } from './lib/workspace-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(HERE, '..');

// CLI surface
// -----------
//   (no flags)      generate into src/gen/ (the committed tree)
//   --out=<dir>     generate into <dir> instead, leaving src/gen/ untouched.
//                   Used by scripts/check-proto-bindings-fresh.mjs to produce
//                   the "expected" tree for a byte-diff.
//   --probe         resolve the daemon-local proto tree, print a JSON report to
//                   stdout, and exit 0 whether or not it is present. Lets
//                   the freshness gate decide between FULL and STRUCTURAL mode
//                   without duplicating this file's path resolution.
const ARGV = process.argv.slice(2);
const PROBE = ARGV.includes('--probe');
const OUT_FLAG = ARGV.find((a) => a.startsWith('--out='));
const OUT_DIR = OUT_FLAG
  ? path.resolve(process.cwd(), OUT_FLAG.slice('--out='.length))
  : path.join(DASHBOARD_ROOT, 'src/gen');

// Each invocation gets its own scratch workspace so a `--out=` run (the
// freshness gate) can never race or clobber a concurrent plain regen.
const WS = path.join(
  DASHBOARD_ROOT,
  `.tmp/proto-ws${OUT_FLAG ? `-${process.pid}` : ''}`,
);

// The OSS SDK protos come from the Buf Schema Registry at one pinned release.
// A release label of the SDK module does not move. This is the one place that
// names the version.
const SDK_BSR_MODULE = 'buf.build/zeroroot-ai/sdk';
const SDK_BSR_VERSION = 'v0.193.1';
const SDK_BSR_REF = `${SDK_BSR_MODULE}:${SDK_BSR_VERSION}`;

// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. `go.mod` is the marker that
// proves a candidate directory really is the gibson repository.
const GIBSON_REPO_MARKER = 'go.mod';
const gibsonFound = resolveRepoPath('gibson', GIBSON_REPO_MARKER, {
  from: DASHBOARD_ROOT,
});
const GIBSON_REPO = gibsonFound?.repoRoot ?? path.join(DASHBOARD_ROOT, 'gibson');
// gibson daemon-local proto tree. Post-#787 reorg this lives under
// internal/server/daemon/api. It hosts the daemon-internal services
// (TracesService, session, world, user) plus the PRIVATE platform
// services that used to live in platform-sdk: DaemonOperatorService
// (gibson.daemon.operator.v1), BillingService (gibson.billing.v1), and
// DiscoveryService (gibson.daemon.discovery.v1). platform-sdk was
// dissolved in gibson#781.
const GIBSON_LOCAL_PROTOS = path.join(GIBSON_REPO, 'internal/server/daemon/api');

/**
 * Run a child process with an explicit argv array and NO shell.
 *
 * This is the one place in this file that spawns anything, so the rationale
 * lives here. `execSync(cmd)` hands its argument to `/bin/sh`, which re-parses
 * it: every value interpolated into the string (a resolved workspace path, a
 * module directory, an output directory) stops being data the moment it
 * contains `;`, `$(...)`, a backtick, a quote or a glob. `execFileSync(file,
 * args)` passes argv straight to `execve`, so no interpolated value can ever
 * become syntax. The values here are developer/operator-controlled rather than
 * attacker-controlled, so this was never exploitable in practice — argv just
 * removes the class outright.
 *
 * @param {string} file  - Executable to run.
 * @param {string[]} args - Argument vector (never a command line).
 * @param {{stdio?: any, cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 */
function run(file, args, opts = {}) {
  return execFileSync(file, args, {
    stdio: opts.stdio ?? 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd ?? DASHBOARD_ROOT,
    ...(opts.env ? { env: opts.env } : {}),
  });
}

function ensureGibsonLocalProtos({ soft = false } = {}) {
  // No-op-style sanity check: the daemon-local protos must exist.
  // They are not a published module, so we can only get them via a
  // gibson checkout. Presence is a filesystem question, so existsSync
  // answers it in process.
  if (existsSync(GIBSON_LOCAL_PROTOS)) return true;
  if (soft) return false;
  console.error(
    'proto-generate: gibson daemon-local protos not found at:\n' +
      `    ${GIBSON_LOCAL_PROTOS}\n` +
      '  Clone zeroroot-ai/gibson alongside this dashboard checkout, or\n' +
      '  run from the canonical workspace at ~/Code/zeroroot.ai/.',
  );
  process.exit(1);
}

function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  // The symlink brings the daemon-local proto tree inside the buf.yaml's
  // context directory (the .tmp/proto-ws root). Buf v2 follows symlinks; this
  // satisfies the "modules must be inside the workspace" rule without
  // copying files. The SDK protos need no symlink: they are a registry
  // dependency.
  ensureGibsonLocalProtos();
  symlinkSync(GIBSON_LOCAL_PROTOS, path.join(WS, 'gibson-local'));

  writeFileSync(
    path.join(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      // gibson-local is the daemon-internal proto tree. It owns the
      // daemon-internal services (TracesService, session, world, user)
      // and the PRIVATE platform services that used to live in
      // platform-sdk: DaemonOperatorService (gibson.daemon.operator.v1),
      // BillingService (gibson.billing.v1), DiscoveryService
      // (gibson.daemon.discovery.v1). platform-sdk was dissolved in
      // gibson#781.
      // gibson/auth/v1/options.proto is the annotation extension; it
      // lives canonically in the OSS SDK and is imported (not vendored)
      // by the daemon-local protos. Exclude it here so buf does not see
      // a second copy next to the one in the SDK registry module.
      '  - path: gibson-local',
      '    excludes:',
      '      - gibson-local/gibson/auth',
      // The dashboard consumes the three ex-platform-sdk platform services
      // (billing / operator / discovery) plus session + world from the
      // daemon-local tree. session_pb.ts is already committed and is not
      // re-sourced here; user is not consumed by the dashboard. world is
      // re-sourced (the exclusion was lifted in gibson#1061 so the World
      // bindings — WorkItemView and the rest — regenerate properly from the
      // daemon-local proto rather than being hand-edited). Exclude the rest.
      '      - gibson-local/gibson/session',
      '      - gibson-local/gibson/user',
      // The SDK protos, at the pinned release. The daemon-local protos
      // import them, and `buf dep update` below resolves the release label
      // to one commit and one digest in buf.lock.
      // protovalidate provides the (buf.validate.field).* annotations
      // that the SDK protos use.
      'deps:',
      `  - ${SDK_BSR_REF}`,
      '  - buf.build/bufbuild/protovalidate',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      // gibson-local protos follow daemon-internal conventions, not the
      // dashboard OSS SDK lint rule. Ignore them to avoid false positives.
      '    - gibson-local',
      '',
    ].join('\n'),
  );

  writeFileSync(
    path.join(WS, 'buf.gen.yaml'),
    [
      'version: v2',
      'plugins:',
      '  - local: protoc-gen-es',
      '    out: out',
      '    opt:',
      '      - target=ts',
      '      - import_extension=none',
      'inputs:',
      `  - module: ${SDK_BSR_REF}`,
      '  - directory: gibson-local',
      // Generate TS bindings for the protovalidate annotation proto so
      // imports of file_buf_validate_validate from generated SDK files
      // resolve. Without this, src/gen/buf/validate/validate_pb.ts is
      // missing and the SDK's mission_definition_pb.ts fails to compile.
      '  - module: buf.build/bufbuild/protovalidate',
      '',
    ].join('\n'),
  );

  return WS;
}

function generate() {
  const ws = buildWorkspace();
  console.log(`proto-generate: workspace at ${path.relative(DASHBOARD_ROOT, ws)}`);

  // Resolve the two registry deps declared in buf.yaml. Writes a buf.lock
  // alongside the generated buf.yaml, which pins each dep to one commit and
  // one digest for the `buf generate` below.
  //
  // There is no offline path. The SDK protos are in the registry only, so a
  // run that cannot reach it stops here. It never reads a checkout in place
  // of the registry.
  try {
    run('npx', ['buf', 'dep', 'update'], {
      cwd: ws,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(
      `proto-generate: \`buf dep update\` failed, so ${SDK_BSR_REF} did not resolve.\n` +
        '  The SDK protos come from the Buf Schema Registry (ADR-0028).\n' +
        '  Make sure that this host reaches buf.build and that the release exists.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    rmSync(ws, { recursive: true, force: true });
    process.exit(1);
  }

  // Run buf generate via the dashboard's npx (so we use the version
  // pinned in package.json, not whatever the system has).
  run('npx', ['buf', 'generate'], {
    cwd: ws,
    stdio: 'inherit',
  });

  const out = path.join(ws, 'out');
  if (OUT_FLAG) {
    // Freshness-gate mode: the caller wants exactly what the generator
    // produced, nothing else. `--delete` (and no `--update`) so the
    // destination is a faithful mirror, not a merge over stale content.
    mkdirSync(OUT_DIR, { recursive: true });
    // argv, and `--` before the operands so a path can be neither shell syntax
    // nor an rsync option.
    run('rsync', ['-a', '--delete', '--', `${out}/`, `${OUT_DIR}/`], {
      stdio: 'inherit',
    });
  } else {
    // rsync --update keeps unchanged files untouched (preserves mtimes
    // for incremental tooling) and only writes diffs. Output destination
    // is the committed src/gen/ tree.
    run('rsync', ['-a', '--update', '--', `${out}/`, `${OUT_DIR}/`], {
      stdio: 'inherit',
    });
  }

  // Clean up. The workspace is regenerated on every run; persistent
  // state in .tmp/proto-ws would just risk staleness.
  rmSync(ws, { recursive: true, force: true });
  console.log(`proto-generate: ok (${OUT_DIR})`);
}

function probe() {
  const gibsonLocalProtos = ensureGibsonLocalProtos({ soft: true })
    ? GIBSON_LOCAL_PROTOS
    : null;
  process.stdout.write(
    JSON.stringify(
      {
        gibsonRepo: gibsonFound ? GIBSON_REPO : null,
        // The SDK protos are a registry reference, not a path on the disk.
        sdkModule: SDK_BSR_REF,
        gibsonLocalProtos,
        // The daemon-local tree is the one source that must be on the disk.
        // Without it the gate falls back to STRUCTURAL mode.
        available: Boolean(gibsonLocalProtos),
      },
      null,
      2,
    ) + '\n',
  );
}

if (PROBE) {
  probe();
} else {
  generate();
}
