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

// Workspace root: ~/Code/zeroroot.ai/. Sibling repos hang off here.
// Dashboard lives at enterprise/platform/dashboard so the workspace root
// is three levels up. Gibson lives at enterprise/platform/gibson — the
// `core/` prefix was the pre-refactor layout and is no longer present.
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
const GIBSON_LOCAL_PROTOS = path.join(GIBSON_REPO, 'internal/daemon/api');
// platform-sdk is a sibling repo at opensource/platform-sdk. Unlike the
// OSS SDK (resolved via `go list -m` against gibson's go.mod), platform-sdk's
// proto tree is consumed directly from the sibling checkout — it's the
// authoritative home for daemon-admin / authz / budget / usage / discovery
// protos that previously lived under sdk/api/proto. Parent PRD
// zeroroot-ai/.github#101.
const PLATFORM_SDK_REPO = path.join(WORKSPACE_ROOT, 'opensource/platform-sdk');
const PLATFORM_SDK_PROTOS = path.join(PLATFORM_SDK_REPO, 'proto');

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: opts.stdio ?? 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd ?? DASHBOARD_ROOT,
  });
}

function resolveSdkProtoDir() {
  // Prefer the sibling checkout at opensource/sdk when present — it
  // tracks main and avoids the "gibson go.mod pin lags one minor
  // version behind the latest sdk release" hazard during multi-repo
  // migrations (e.g. capability extraction in sdk#103 vs admin
  // removal in sdk#105). Sibling checkout is also the standard layout
  // for this workspace; the module-cache fallback exists for the case
  // where the dashboard repo is being regen'd outside the polyrepo.
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
      'proto-generate: daemon-local protos not found at:\n' +
        `    ${GIBSON_LOCAL_PROTOS}\n` +
        '  Clone zeroroot-ai/gibson alongside this dashboard checkout, or\n' +
        '  run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    process.exit(1);
  }
}

function ensurePlatformSdkProtos() {
  // Sibling-checkout sanity check for the platform-sdk proto tree
  // (zeroroot-ai/platform-sdk → opensource/platform-sdk). The dashboard
  // pulls daemon-admin / authz / budget / usage / daemon-discovery
  // protos from here as part of the OSS-SDK → platform-sdk migration
  // (parent PRD zeroroot-ai/.github#101).
  try {
    const stat = run(`stat ${PLATFORM_SDK_PROTOS}`);
    if (!stat) throw new Error('stat empty');
  } catch (err) {
    console.error(
      'proto-generate: platform-sdk protos not found at:\n' +
        `    ${PLATFORM_SDK_PROTOS}\n` +
        '  Clone zeroroot-ai/platform-sdk at opensource/platform-sdk in your\n' +
        '  workspace, or run from the canonical workspace at\n' +
        '  ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}`,
    );
    process.exit(1);
  }
}

function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  const sdkProtoDir = resolveSdkProtoDir();
  ensurePlatformSdkProtos();

  // Symlinks bring the three proto trees inside the buf.yaml's context
  // directory (the .tmp/proto-ws root). Buf v2 follows symlinks; this
  // satisfies the "modules must be inside the workspace" rule without
  // copying files.
  // gibson-local is included for daemon-internal protos that have not
  // yet been promoted to platform-sdk. Currently: TracesService
  // (dashboard#588 cutover). Once these protos are promoted to
  // platform-sdk the gibson-local symlink can be removed again.
  ensureGibsonLocalProtos();
  symlinkSync(sdkProtoDir, path.join(WS, 'sdk-proto'));
  symlinkSync(PLATFORM_SDK_PROTOS, path.join(WS, 'platform-sdk-proto'));
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
      // The following proto packages were migrated to platform-sdk
      // (parent PRD zeroroot-ai/.github#101). The OSS SDK still ships
      // them at module level until sdk#105 lands; exclude them here
      // so buf does not see two copies of each file. After sdk#105
      // merges, these directories vanish from the OSS SDK and the
      // exclude becomes a no-op (kept for tag-skew safety).
      '      - sdk-proto/gibson/admin',
      '      - sdk-proto/gibson/authz',
      '      - sdk-proto/gibson/budget',
      '      - sdk-proto/gibson/daemon/discovery',
      '      - sdk-proto/gibson/usage',
      // platform-sdk is the new authoritative home for daemon-admin /
      // authz / budget / usage / daemon-discovery protos (parent PRD
      // zeroroot-ai/.github#101). Listed after sdk-proto so its
      // descriptors win on the conflict-free namespaces it owns.
      // gibson/auth/v1/options.proto is intentionally shared between
      // OSS SDK and platform-sdk via the same on-disk file (see the
      // platform-sdk "share gibson.auth.v1 with oss sdk" change) —
      // exclude here so buf doesn't see two copies under the two
      // module roots.
      '  - path: platform-sdk-proto',
      '    excludes:',
      '      - platform-sdk-proto/gibson/auth',
      // gibson.capability.v1 is canonically OSS-SDK-owned (sdk#103
      // extraction). platform-sdk vendors a copy purely so its
      // gibson.admin.v1 services can resolve the import; we read
      // capability.proto from the OSS SDK side instead.
      '      - platform-sdk-proto/gibson/capability',
      // gibson-local is the daemon-internal proto tree for services not yet
      // promoted to platform-sdk. Only TracesService is consumed by the
      // dashboard (dashboard#588). All other daemon-local packages
      // (billing, user) duplicate platform-sdk namespaces or are not
      // needed here; exclude them to avoid conflicts.
      '  - path: gibson-local',
      '    excludes:',
      '      - gibson-local/gibson/auth',
      '      - gibson-local/gibson/billing',
      '      - gibson-local/gibson/user',
      // protovalidate provides the (buf.validate.field).* annotations
      // adopted by the SDK from v1.5.0 onward. Pulled from the buf.build
      // remote registry; resolved by `buf dep update` invoked below.
      'deps:',
      '  - buf.build/bufbuild/protovalidate',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      // Daemon admin proto deliberately doesn\'t carry the standard
      // suffix lint contract; same exclusion the daemon-side
      // `make authz-registry` uses. The proto lives in platform-sdk
      // post-migration (parent PRD zeroroot-ai/.github#101).
      '    - platform-sdk-proto/gibson/daemon/admin/v1/daemon_admin.proto',
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
      '  - directory: platform-sdk-proto',
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
  execSync(`npx buf dep update`, {
    cwd: ws,
    stdio: 'inherit',
  });

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
