#!/usr/bin/env node
/**
 * proto-generate, regenerate the dashboard's TypeScript proto bindings
 * from the SDK's published protos plus the gibson daemon-local protos at
 * `enterprise/platform/gibson/internal/server/daemon/api/`.
 *
 * Buf v2 requires every module path in buf.yaml to resolve INSIDE the
 * directory containing buf.yaml. The dashboard imports protos from two
 * places that live OUTSIDE the dashboard repo: the SDK (Go module
 * cache, resolved via `go list -m`) and the gibson daemon-local proto
 * tree (sibling checkout). Neither can sit "above" the dashboard root.
 *
 * To make buf happy, this script synthesises a temporary workspace at
 * `.tmp/proto-ws/` *inside* the dashboard, populates it with symlinks
 * to the two real proto trees, drops a generated buf.yaml + buf.gen.yaml
 * inside that workspace, runs `buf generate` from there, and rsyncs the
 * output back into `src/gen/`.
 *
 * The pattern is the same one the daemon already uses for `make
 * authz-registry`, see `enterprise/platform/gibson/Makefile`'s
 * `authz-registry` recipe, which builds a `.tmp/ws/` workspace by
 * symlinking the SDK proto root and the daemon-local proto root.
 *
 * The PRIVATE platform protos (`gibson.daemon.operator.v1`,
 * `gibson.billing.v1`, `gibson.daemon.discovery.v1`) used to live in the
 * separate `platform-sdk` module; they now live in the gibson daemon-local
 * tree alongside the rest of the daemon-internal services, and the
 * `platform-sdk` module has been dissolved (open-core monorepo
 * consolidation, ADR-0056, gibson#781).
 *
 * **Workstation-only:** this script assumes the gibson repo is cloned
 * as a sibling of the dashboard repo, exactly as the rest of this
 * polyrepo workspace already requires. CI does not regenerate proto
 * bindings, `src/gen/` is committed and CI just typechecks it.
 *
 * Spec: component-bootstrap-dashboard-completion (proto-gen workflow).
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
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

// Pinned protovalidate BSR module, mirrors the SDK's committed buf.lock.
// Used as an offline fallback when `buf dep update` can't reach the BSR
// (no token) but the module is already in the local buf cache.
const PROTOVALIDATE_COMMIT = '50325440f8f24053b047484a6bf60b76';
const PROTOVALIDATE_DIGEST =
  'b5:74cb6f5c0853c3c10aafc701614194bbd63326bdb8ef4068214454b8894b03ba4113e04b3a33a8321cdf05336e37db4dc14a5e2495db8462566914f36086ba31';

// Workspace root: ~/Code/zeroroot.ai/. Sibling repos hang off here.
// Dashboard lives at enterprise/platform/dashboard so the workspace root
// is three levels up. Gibson lives at enterprise/platform/gibson.
//
// Worktree-aware: when run from .worktrees/<name>/scripts/ or
// .claude/worktrees/<name>/scripts/, DASHBOARD_ROOT resolves to the
// worktree directory and the naive `../../..` walks short. Detect both
// patterns and rewind to the main checkout root before computing the
// workspace root. dashboard#148.
const isWorktree =
  DASHBOARD_ROOT.includes('/.worktrees/') ||
  DASHBOARD_ROOT.includes('/.claude/worktrees/');
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.claude\/worktrees\/[^/]+$/, '').replace(/\/\.worktrees\/[^/]+$/, '')
  : DASHBOARD_ROOT;
const WORKSPACE_ROOT = path.resolve(MAIN_DASHBOARD_ROOT, '..', '..', '..');
const GIBSON_REPO = path.join(WORKSPACE_ROOT, 'enterprise/platform/gibson');
// gibson daemon-local proto tree. Post-#787 reorg this lives under
// internal/server/daemon/api. It hosts the daemon-internal services
// (TracesService, session, world, user) plus the PRIVATE platform
// services that used to live in platform-sdk: DaemonOperatorService
// (gibson.daemon.operator.v1), BillingService (gibson.billing.v1), and
// DiscoveryService (gibson.daemon.discovery.v1). platform-sdk was
// dissolved in gibson#781.
const GIBSON_LOCAL_PROTOS = path.join(GIBSON_REPO, 'internal/server/daemon/api');

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: opts.stdio ?? 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd ?? DASHBOARD_ROOT,
  });
}

function resolveSdkProtoDir() {
  // Prefer the sibling checkout at opensource/sdk when present, it
  // tracks main and avoids the "gibson go.mod pin lags one minor
  // version behind the latest sdk release" hazard during multi-repo
  // migrations. Sibling checkout is also the standard layout for this
  // workspace; the module-cache fallback exists for the case where the
  // dashboard repo is being regen'd outside the polyrepo.
  const SDK_SIBLING = path.join(WORKSPACE_ROOT, 'opensource/sdk/api/proto');
  try {
    const stat = run(`stat ${SDK_SIBLING}`);
    if (stat) return SDK_SIBLING;
  } catch {
    // fall through to module-cache resolution
  }

  // Module-cache fallback: `go list -m` against the gibson repo
  // resolves the SDK to whichever version gibson is pinned to. Only
  // hit when the sibling checkout is absent.
  try {
    const dir = run('go list -m -f "{{.Dir}}" github.com/zeroroot-ai/sdk', {
      cwd: GIBSON_REPO,
    }).trim();
    if (!dir) throw new Error('empty');
    return path.join(dir, 'api/proto');
  } catch (err) {
    console.error(
      'proto-generate: failed to resolve github.com/zeroroot-ai/sdk.\n' +
        `  Tried sibling checkout at: ${SDK_SIBLING}\n` +
        `  Tried module-cache via gibson at: ${GIBSON_REPO}\n` +
        '  Clone zeroroot-ai/sdk at opensource/sdk in your workspace,\n' +
        '  or run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
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
      'proto-generate: gibson daemon-local protos not found at:\n' +
        `    ${GIBSON_LOCAL_PROTOS}\n` +
        '  Clone zeroroot-ai/gibson alongside this dashboard checkout, or\n' +
        '  run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    process.exit(1);
  }
}

function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  const sdkProtoDir = resolveSdkProtoDir();

  // Symlinks bring the two proto trees inside the buf.yaml's context
  // directory (the .tmp/proto-ws root). Buf v2 follows symlinks; this
  // satisfies the "modules must be inside the workspace" rule without
  // copying files.
  ensureGibsonLocalProtos();
  symlinkSync(sdkProtoDir, path.join(WS, 'sdk-proto'));
  symlinkSync(GIBSON_LOCAL_PROTOS, path.join(WS, 'gibson-local'));

  writeFileSync(
    path.join(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      // The SDK vendors well-known google/* protos with a
      // non-conforming go_package; excluding them from the module is
      // critical (otherwise protoc-gen-* plugins choke on them and
      // the dashboard ends up shipping a duplicate src/gen/google/
      // tree that conflicts with @bufbuild/protobuf\'s built-ins).
      '  - path: sdk-proto',
      '    excludes:',
      '      - sdk-proto/google',
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
      // two copies under the two module roots.
      '  - path: gibson-local',
      '    excludes:',
      '      - gibson-local/gibson/auth',
      // The dashboard consumes only the three ex-platform-sdk platform
      // services (billing / operator / discovery) plus session + world
      // from the daemon-local tree. session_pb.ts and world_pb.ts are
      // already committed and are not re-sourced here to keep the
      // platform-sdk dissolution (gibson#781) change minimal; user is not
      // consumed by the dashboard. Exclude them so this regen only emits
      // the billing/operator/discovery bindings being relocated.
      '      - gibson-local/gibson/session',
      '      - gibson-local/gibson/user',
      '      - gibson-local/gibson/world',
      // protovalidate provides the (buf.validate.field).* annotations
      // adopted by the SDK from v1.5.0 onward. Pulled from the buf.build
      // remote registry; resolved by `buf dep update` invoked below.
      'deps:',
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
      '  - directory: sdk-proto',
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

  // Resolve the protovalidate dep declared in buf.yaml. Writes a
  // buf.lock alongside the generated buf.yaml so `buf generate` can
  // find the (buf.validate.field).* import.
  //
  // `buf dep update` contacts the BSR to re-resolve the pin, which
  // requires a valid BSR token. On a workstation that already has the
  // protovalidate module cached (every prior gibson `make proto` /
  // dashboard `pnpm proto:generate` warms it), the network round-trip is
  // unnecessary: `buf generate` resolves the dep from the local module
  // cache as long as a buf.lock pins the commit. So tolerate a failed
  // `dep update` and fall back to a pinned buf.lock; `buf generate` below
  // is the real gate (it errors clearly if the dep can't resolve).
  let offline = false;
  try {
    execSync(`npx buf dep update`, {
      cwd: ws,
      stdio: 'inherit',
    });
  } catch {
    offline = true;
    console.warn(
      'proto-generate: `buf dep update` failed (offline / no BSR token); ' +
        'falling back to pinned buf.lock + local module cache',
    );
    if (!existsSync(path.join(ws, 'buf.lock'))) {
      writeFileSync(
        path.join(ws, 'buf.lock'),
        [
          '# Generated by buf. DO NOT EDIT.',
          'version: v2',
          'deps:',
          '  - name: buf.build/bufbuild/protovalidate',
          `    commit: ${PROTOVALIDATE_COMMIT}`,
          `    digest: ${PROTOVALIDATE_DIGEST}`,
          '',
        ].join('\n'),
      );
    }
  }

  // Run buf generate via the dashboard's npx (so we use the version
  // pinned in package.json, not whatever the system has). When we fell
  // back to the offline path, point NETRC at /dev/null so buf does not
  // try to authenticate against the BSR with a stale/invalid token in
  // ~/.netrc — it resolves the pinned dep straight from the local cache.
  execSync(`npx buf generate`, {
    cwd: ws,
    stdio: 'inherit',
    env: offline ? { ...process.env, NETRC: '/dev/null' } : process.env,
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
