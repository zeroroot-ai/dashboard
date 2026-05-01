#!/usr/bin/env node
/**
 * proto-generate — regenerate the dashboard's TypeScript proto bindings
 * from the SDK's published protos plus the daemon-local protos at
 * `core/gibson/internal/daemon/api/`.
 *
 * Buf v2 requires every module path in buf.yaml to resolve INSIDE the
 * directory containing buf.yaml. The dashboard imports protos from two
 * places that live OUTSIDE the dashboard repo: the SDK (Go module
 * cache, resolved via `go list -m`) and the daemon-local proto tree
 * (sibling checkout at `core/gibson/internal/daemon/api/`). Neither
 * can sit "above" the dashboard root.
 *
 * To make buf happy, this script synthesises a temporary workspace at
 * `.tmp/proto-ws/` *inside* the dashboard, populates it with symlinks
 * to the two real proto trees, drops a generated buf.yaml + buf.gen.yaml
 * inside that workspace, runs `buf generate` from there, and rsyncs the
 * output back into `src/gen/`.
 *
 * The pattern is the same one the daemon already uses for `make
 * authz-registry` — see `core/gibson/Makefile`'s `authz-registry`
 * recipe, which builds a `.tmp/ws/` workspace by symlinking the SDK
 * proto root and the daemon-local proto root.
 *
 * **Workstation-only:** this script assumes the daemon repo is cloned
 * as a sibling of the dashboard repo, exactly as the rest of this
 * polyrepo workspace already requires. CI does not regenerate proto
 * bindings — `src/gen/` is committed and CI just typechecks it.
 *
 * Spec: component-bootstrap-dashboard-completion (proto-gen workflow).
 */

import { execSync } from 'node:child_process';
import {
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(HERE, '..');
const WS = path.join(DASHBOARD_ROOT, '.tmp/proto-ws');

// Workspace root: ~/Code/zero-day.ai/. Sibling repos hang off here.
const WORKSPACE_ROOT = path.resolve(DASHBOARD_ROOT, '..', '..', '..');
const GIBSON_REPO = path.join(WORKSPACE_ROOT, 'core/gibson');
const GIBSON_LOCAL_PROTOS = path.join(GIBSON_REPO, 'internal/daemon/api');

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: opts.stdio ?? 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd ?? DASHBOARD_ROOT,
  });
}

function resolveSdkProtoDir() {
  // `go list -m` against the gibson repo resolves the SDK to its
  // module-cache directory regardless of which version it is pinned
  // to. This avoids hard-coding a sibling-checkout assumption for the
  // SDK side of the workspace; only the daemon-local protos require a
  // sibling checkout (because they are not published).
  try {
    const dir = run('go list -m -f "{{.Dir}}" github.com/zero-day-ai/sdk', {
      cwd: GIBSON_REPO,
    }).trim();
    if (!dir) throw new Error('empty');
    return path.join(dir, 'api/proto');
  } catch (err) {
    console.error(
      'proto-generate: failed to resolve github.com/zero-day-ai/sdk via `go list -m`.\n' +
        '  This script expects the gibson daemon repo cloned at:\n' +
        `    ${GIBSON_REPO}\n` +
        '  with `go.mod` resolving the SDK as a Go module dependency.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    process.exit(1);
  }
}

function ensureGibsonLocalProtos() {
  // No-op-style sanity check: the daemon-local protos must exist.
  // They are not a published Go module, so we can only get them via a
  // sibling checkout.
  try {
    const stat = run(`stat ${GIBSON_LOCAL_PROTOS}`);
    if (!stat) throw new Error('stat empty');
  } catch (err) {
    console.error(
      'proto-generate: daemon-local protos not found at:\n' +
        `    ${GIBSON_LOCAL_PROTOS}\n` +
        '  Clone zero-day-ai/gibson alongside this dashboard checkout, or\n' +
        '  run from the canonical workspace at ~/Code/zero-day.ai/.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    process.exit(1);
  }
}

function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  const sdkProtoDir = resolveSdkProtoDir();
  ensureGibsonLocalProtos();

  // Symlinks bring the two proto trees inside the buf.yaml's context
  // directory (the .tmp/proto-ws root). Buf v2 follows symlinks; this
  // satisfies the "modules must be inside the workspace" rule without
  // copying files.
  symlinkSync(GIBSON_LOCAL_PROTOS, path.join(WS, 'gibson-local'));
  symlinkSync(sdkProtoDir, path.join(WS, 'sdk-proto'));

  writeFileSync(
    path.join(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      '  - path: gibson-local',
      // The SDK vendors well-known google/* protos with a
      // non-conforming go_package; excluding them from the module is
      // critical (otherwise protoc-gen-* plugins choke on them and
      // the dashboard ends up shipping a duplicate src/gen/google/
      // tree that conflicts with @bufbuild/protobuf\'s built-ins).
      '  - path: sdk-proto',
      '    excludes:',
      '      - sdk-proto/google',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      // Daemon admin proto deliberately doesn\'t carry the standard
      // suffix lint contract; same exclusion the daemon-side
      // `make authz-registry` uses.
      '    - gibson-local/gibson/daemon/admin/v1/daemon_admin.proto',
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
      '  - directory: gibson-local',
      '  - directory: sdk-proto',
      '',
    ].join('\n'),
  );

  return WS;
}

function generate() {
  const ws = buildWorkspace();
  console.log(`proto-generate: workspace at ${path.relative(DASHBOARD_ROOT, ws)}`);

  // Run buf generate via the dashboard's npx (so we use the version
  // pinned in package.json, not whatever the system has).
  execSync(`npx buf generate`, {
    cwd: ws,
    stdio: 'inherit',
  });

  // rsync --update keeps unchanged files untouched (preserves mtimes
  // for incremental tooling) and only writes diffs. Output destination
  // is the committed src/gen/ tree.
  const out = path.join(ws, 'out');
  const dst = path.join(DASHBOARD_ROOT, 'src/gen') + '/';
  execSync(`rsync -a --update ${out}/ ${dst}`, { stdio: 'inherit' });

  // Clean up. The workspace is regenerated on every run; persistent
  // state in .tmp/proto-ws would just risk staleness.
  rmSync(ws, { recursive: true, force: true });
  console.log('proto-generate: ok');
}

generate();
