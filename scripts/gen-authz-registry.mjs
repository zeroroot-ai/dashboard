#!/usr/bin/env node
/**
 * Generate src/gen/authz/registry.ts from the SDK, platform-sdk, and
 * daemon-local proto FileDescriptorSets.
 *
 * Reads every service method in all three proto trees, decodes the
 * (gibson.auth.v1.authz) extension (field 50001 on MethodOptions), and emits
 * a TypeScript module with the AuthEntry type, IdentityClass constants, and
 * AuthRegistry record.
 *
 * Workspace synthesis
 * -------------------
 * Buf v2 has a hard rule that every module path in buf.yaml must resolve INSIDE
 * the directory containing the buf.yaml. The SDK protos (resolved from the
 * gibson repo's go.mod), platform-sdk protos (sibling checkout), and
 * daemon-local protos live outside this dashboard repo, so they cannot be
 * referenced with ../../ paths. Instead, this script synthesises a temporary
 * workspace at .tmp/proto-ws/ (same pattern as proto-generate.mjs), populates
 * it with symlinks, and runs buf build from inside that workspace. The
 * workspace is always cleaned up in a finally block.
 *
 * Three proto trees
 * -----------------
 * 1. sdk-proto      , OSS SDK (DaemonService, gibson.tenant.v1, etc.)
 * 2. platform-sdk-proto, PRIVATE platform-sdk (gibson.admin.v1,
 *                        gibson.daemon.operator.v1, gibson.user.v1, etc.)
 * 3. gibson-local   , daemon-internal protos not yet promoted to platform-sdk
 *
 * This mirrors the three-tree pattern in proto-generate.mjs and ensures that
 * admin + operator service methods are present in the registry for the
 * assertAuthorized / useAuthorize gating layer.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 2.1–2.3.
 * Dashboard issue: #406 (gibson.admin.v1 and gibson.daemon.operator.v1 absent).
 *
 * Usage
 * -----
 *   node scripts/gen-authz-registry.mjs            # writes src/gen/authz/registry.ts
 *   node scripts/gen-authz-registry.mjs --stdout   # prints to stdout (for drift gate)
 *
 * Determinism
 * -----------
 * Entries are sorted by method name. The script MUST produce byte-identical
 * output for the same proto input, the drift gate relies on this.
 */

import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromBinary } from '@bufbuild/protobuf';
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
const WS = resolve(DASHBOARD_ROOT, '.tmp/proto-ws');
const OUTPUT_PATH = resolve(DASHBOARD_ROOT, 'src/gen/authz/registry.ts');

// Workspace root: ~/Code/zeroroot.ai/. Sibling repos hang off here.
// Gibson lives at enterprise/platform/gibson, the `core/` prefix was the
// pre-refactor layout and is no longer present.
//
// Worktree-aware: when DASHBOARD_ROOT is .worktrees/<name>/ or
// .claude/worktrees/<name>/ (the Claude Code harness layout) the naive
// `../../..` walk lands short of the workspace root. Rewind to the main
// checkout root before walking up. dashboard#148, dashboard#406.
const isWorktree =
  DASHBOARD_ROOT.includes('/.worktrees/') || DASHBOARD_ROOT.includes('/.claude/worktrees/');
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.claude\/worktrees\/[^/]+$/, '').replace(
      /\/\.worktrees\/[^/]+$/,
      '',
    )
  : DASHBOARD_ROOT;
const WORKSPACE_ROOT = resolve(MAIN_DASHBOARD_ROOT, '..', '..', '..');
const GIBSON_REPO = resolve(WORKSPACE_ROOT, 'enterprise/platform/gibson');
const GIBSON_LOCAL_PROTOS = resolve(GIBSON_REPO, 'internal/daemon/api');
// platform-sdk is a sibling repo at opensource/platform-sdk. It is the
// authoritative home for gibson.admin.v1, gibson.daemon.operator.v1,
// gibson.user.v1, and other private admin/operator proto packages. These
// namespaces must be present in the AuthRegistry so assertAuthorized /
// useAuthorize can gate access to those RPCs. dashboard#406.
const PLATFORM_SDK_REPO = resolve(WORKSPACE_ROOT, 'opensource/platform-sdk');
const PLATFORM_SDK_PROTOS = resolve(PLATFORM_SDK_REPO, 'proto');

// Extension field number for (gibson.auth.v1.authz) on MethodOptions.
// Hard-coded per spec: "Field number 50001 is reserved for Gibson's authorization
// annotations and MUST NOT change."
const AUTHZ_EXTENSION_FIELD = 50001;

// ---------------------------------------------------------------------------
// Workspace synthesis (verbatim pattern from proto-generate.mjs)
// ---------------------------------------------------------------------------

function resolveSdkProtoDir() {
  // Prefer the sibling checkout at opensource/sdk when present, it
  // tracks main and avoids the "gibson go.mod pin lags one minor
  // version behind the latest sdk release" hazard. Mirrors the pattern
  // in proto-generate.mjs.
  const SDK_SIBLING = resolve(WORKSPACE_ROOT, 'opensource/sdk/api/proto');
  try {
    execSync(`stat ${SDK_SIBLING}`, { stdio: 'pipe' });
    return SDK_SIBLING;
  } catch {
    // fall through to module-cache resolution
  }

  // Module-cache fallback: `go list -m` against the gibson repo resolves
  // the SDK to whichever version gibson is pinned to.
  try {
    const dir = execSync('go list -m -f "{{.Dir}}" github.com/zeroroot-ai/sdk', {
      cwd: GIBSON_REPO,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (!dir) throw new Error('empty');
    return resolve(dir, 'api/proto');
  } catch (err) {
    process.stderr.write(
      '[gen-authz-registry] FATAL: failed to resolve github.com/zeroroot-ai/sdk.\n' +
        `  Tried sibling checkout at: ${SDK_SIBLING}\n` +
        `  Tried module-cache via gibson at: ${GIBSON_REPO}\n` +
        '  Clone zeroroot-ai/sdk at opensource/sdk in your workspace, or\n' +
        '  run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}\n`,
    );
    process.exit(1);
  }
}

function ensureGibsonLocalProtos() {
  try {
    execSync(`stat ${GIBSON_LOCAL_PROTOS}`, { stdio: 'pipe' });
  } catch (err) {
    process.stderr.write(
      '[gen-authz-registry] FATAL: daemon-local protos not found at:\n' +
        `    ${GIBSON_LOCAL_PROTOS}\n` +
        '  Clone zeroroot-ai/gibson alongside this dashboard checkout, or\n' +
        '  run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}\n`,
    );
    process.exit(1);
  }
}

function ensurePlatformSdkProtos() {
  try {
    execSync(`stat ${PLATFORM_SDK_PROTOS}`, { stdio: 'pipe' });
  } catch (err) {
    process.stderr.write(
      '[gen-authz-registry] FATAL: platform-sdk protos not found at:\n' +
        `    ${PLATFORM_SDK_PROTOS}\n` +
        '  Clone zeroroot-ai/platform-sdk at opensource/platform-sdk in your\n' +
        '  workspace, or run from the canonical workspace at ~/Code/zeroroot.ai/.\n' +
        `  Underlying error: ${err.message ?? err}\n`,
    );
    process.exit(1);
  }
}

/**
 * Build the .tmp/proto-ws/ workspace with symlinks to two proto trees:
 * sdk-proto and platform-sdk-proto. The daemon-local proto tree
 * (gibson-local) is intentionally omitted, its only file
 * (gibson/user/v1/user.proto) duplicates the platform-sdk copy and causes
 * a "contained in multiple modules" buf error. See dashboard#406.
 *
 * Two modules:
 *   sdk-proto         , OSS SDK (gibson.tenant.v1, DaemonService, etc.)
 *   platform-sdk-proto, PRIVATE admin/operator protos (gibson.admin.v1,
 *                        gibson.daemon.operator.v1, gibson.user.v1, etc.)
 */
function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  const sdkProtoDir = resolveSdkProtoDir();
  ensurePlatformSdkProtos();

  // Symlinks bring both proto trees inside the buf.yaml's context directory.
  // Buf v2 follows symlinks; this satisfies the "modules must be inside the
  // workspace" rule without copying files.
  symlinkSync(sdkProtoDir, resolve(WS, 'sdk-proto'));
  symlinkSync(PLATFORM_SDK_PROTOS, resolve(WS, 'platform-sdk-proto'));

  writeFileSync(
    resolve(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      '  - path: sdk-proto',
      '    excludes:',
      '      - sdk-proto/google',
      // The following proto packages were migrated to platform-sdk
      // (parent PRD zeroroot-ai/.github#101). Exclude from the OSS SDK
      // module so buf does not see two copies of each file. After
      // sdk#105 merges, these directories vanish from the OSS SDK and
      // the excludes become no-ops (kept for tag-skew safety).
      '      - sdk-proto/gibson/admin',
      '      - sdk-proto/gibson/authz',
      '      - sdk-proto/gibson/budget',
      '      - sdk-proto/gibson/daemon/discovery',
      '      - sdk-proto/gibson/usage',
      // platform-sdk is the authoritative home for daemon-admin /
      // authz / budget / usage / daemon-discovery / daemon-operator
      // protos (parent PRD zeroroot-ai/.github#101). dashboard#406.
      '  - path: platform-sdk-proto',
      '    excludes:',
      // gibson/auth/v1/options.proto is intentionally shared between
      // OSS SDK and platform-sdk; exclude here so buf doesn't see two
      // copies under the two module roots.
      '      - platform-sdk-proto/gibson/auth',
      // gibson.capability.v1 is canonically OSS-SDK-owned (sdk#103
      // extraction). platform-sdk vendors a copy purely so its
      // gibson.admin.v1 services can resolve the import; we read
      // capability.proto from the OSS SDK side instead.
      '      - platform-sdk-proto/gibson/capability',
      // Note: gibson-local (enterprise/platform/gibson/internal/daemon/api)
      // is intentionally omitted. Its only proto file (gibson/user/v1/user.proto)
      // is byte-identical to the platform-sdk copy (different go_package only).
      // Including it would cause a "contained in multiple modules" error.
      // The daemon-local tree has no unique authz-annotated methods that
      // aren't already covered by platform-sdk. dashboard#406.
      // protovalidate provides the (buf.validate.field).* annotations
      // adopted by the SDK from v1.5.0 onward. Pulled from the buf.build
      // remote registry; resolved by `buf dep update` invoked below.
      // Mirror of the proto-generate.mjs setup. dashboard#148.
      'deps:',
      '  - buf.build/bufbuild/protovalidate',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      '    - platform-sdk-proto/gibson/daemon/admin/v1/daemon_admin.proto',
      '',
    ].join('\n'),
  );

  // Resolve the protovalidate dep declared in buf.yaml. Writes a buf.lock
  // alongside the generated buf.yaml so the subsequent `buf build` can
  // resolve the (buf.validate.field).* import without contacting the
  // remote registry on every invocation.
  execSync('npx buf dep update', { cwd: WS, stdio: 'inherit' });

  return { ws: WS };
}

// ---------------------------------------------------------------------------
// Proto binary decoding
// ---------------------------------------------------------------------------

/**
 * Decode a protobuf varint starting at `pos` in `bytes`.
 * Returns [value, nextPos].
 */
function readVarint(bytes, pos) {
  let v = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [v, pos];
}

/**
 * Decode an AuthOptions message from the raw `$unknown` field data.
 *
 * The `$unknown` payload from @bufbuild/protobuf for a length-delimited field
 * (wire type 2) includes a leading varint length prefix, followed by the
 * message bytes. We skip the length prefix, then parse the AuthOptions fields:
 *   1 = relation (string)
 *   2 = object_type (string)
 *   3 = object_deriver (string)
 *   4 = allowed_identities (int32)
 *   5 = unauthenticated (bool)
 */
function decodeAuthOptions(rawData) {
  // Skip the leading length varint.
  const [, start] = readVarint(rawData, 0);
  let pos = start;

  const result = {
    relation: '',
    objectType: '',
    objectDeriver: '',
    allowedIdentities: 0,
    unauthenticated: false,
  };

  while (pos < rawData.length) {
    const [tag, p1] = readVarint(rawData, pos);
    pos = p1;
    const fieldNo = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      // Length-delimited (string / bytes / embedded message).
      const [len, p2] = readVarint(rawData, pos);
      pos = p2;
      const str = Buffer.from(rawData.slice(pos, pos + len)).toString('utf8');
      pos += len;
      if (fieldNo === 1) result.relation = str;
      else if (fieldNo === 2) result.objectType = str;
      else if (fieldNo === 3) result.objectDeriver = str;
    } else if (wireType === 0) {
      // Varint (int32, bool, enum, etc.)
      const [v, p2] = readVarint(rawData, pos);
      pos = p2;
      if (fieldNo === 4) result.allowedIdentities = v;
      else if (fieldNo === 5) result.unauthenticated = v !== 0;
    } else {
      // Unknown wire type, stop parsing this message.
      break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// FDS build
// ---------------------------------------------------------------------------

/**
 * Run `buf build --as-file-descriptor-set` for `modulePath` (relative to the
 * workspace) from inside the workspace directory. Exits the process on failure
 * or empty result. Returns the parsed FileDescriptorSet.
 *
 * @param {string} ws        - Absolute path to the workspace (.tmp/proto-ws/).
 * @param {string} module    - Module path relative to ws (e.g. "sdk-proto").
 * @param {string} label     - Human-readable label for error messages.
 */
function buildFDSFromWorkspace(ws, module, label) {
  const result = spawnSync(
    'npx',
    ['buf', 'build', '--as-file-descriptor-set', '-o', '-', module],
    {
      cwd: ws,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString('utf8') : '(no stderr)';
    process.stderr.write(
      `[gen-authz-registry] FATAL: buf build failed for ${label}: ${stderr}\n`,
    );
    process.exit(1);
  }

  const raw = result.stdout;
  if (!raw || raw.length === 0) {
    process.stderr.write(
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS, is the proto root present?\n`,
    );
    process.exit(1);
  }

  const fds = fromBinary(FileDescriptorSetSchema, raw);

  if (!fds.file || fds.file.length === 0) {
    process.stderr.write(
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS, is the proto root present?\n`,
    );
    process.exit(1);
  }

  return fds;
}

// ---------------------------------------------------------------------------
// FDS scan
// ---------------------------------------------------------------------------

/**
 * Walk all service methods in `fds` and extract every method annotated with
 * the (gibson.auth.v1.authz) extension.
 */
function scanFDS(fds) {
  const entries = [];
  for (const file of fds.file) {
    for (const service of file.service) {
      for (const method of service.method) {
        const unk = method.options?.$unknown;
        if (!unk) continue;
        for (const u of unk) {
          if (u.no === AUTHZ_EXTENSION_FIELD && u.data) {
            const authOpts = decodeAuthOptions(u.data);
            entries.push({
              method: `/${file.package}.${service.name}/${method.name}`,
              service: `${file.package}.${service.name}`,
              ...authOpts,
            });
          }
        }
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * Render an allowedIdentities numeric value as a readable expression using
 * IdentityClass constants, e.g. `IdentityClass.USER | IdentityClass.SERVICE`.
 */
function renderAllowedIdentities(value) {
  if (value === 0) return '0';
  const BITS = [
    [1, 'IdentityClass.USER'],
    [2, 'IdentityClass.SERVICE'],
    [4, 'IdentityClass.COMPONENT'],
    [8, 'IdentityClass.PLATFORM_OPERATOR'],
  ];
  const parts = BITS.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
  return parts.length > 0 ? parts.join(' | ') : String(value);
}

function generateTS(entries) {
  // Sort deterministically by method name.
  const sorted = [...entries].sort((a, b) => a.method.localeCompare(b.method));

  const lines = [];
  lines.push('// Code generated by scripts/gen-authz-registry.mjs. DO NOT EDIT.');
  lines.push('// Spec: dashboard-authz-ui-gating Requirement 1.');
  lines.push('// Regenerate: pnpm gen:authz');
  lines.push('');
  lines.push('export const IdentityClass = {');
  lines.push('  USER: 1,');
  lines.push('  SERVICE: 2,');
  lines.push('  COMPONENT: 4,');
  lines.push('  PLATFORM_OPERATOR: 8,');
  lines.push('} as const;');
  lines.push('');
  lines.push('export type IdentityClassValue = (typeof IdentityClass)[keyof typeof IdentityClass];');
  lines.push('');
  lines.push('export interface AuthEntry {');
  lines.push('  method: string;');
  lines.push('  service: string;');
  lines.push('  relation: string;');
  lines.push('  objectType: string;');
  lines.push('  objectDeriver: string;');
  lines.push('  allowedIdentities: number;');
  lines.push('  unauthenticated: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export const AuthRegistry: Record<string, AuthEntry> = {');

  for (const e of sorted) {
    const allowedExpr = renderAllowedIdentities(e.allowedIdentities);
    lines.push(`  "${e.method}": {`);
    lines.push(`    method: "${e.method}",`);
    lines.push(`    service: "${e.service}",`);
    lines.push(`    relation: "${e.relation}",`);
    lines.push(`    objectType: "${e.objectType}",`);
    lines.push(`    objectDeriver: "${e.objectDeriver}",`);
    lines.push(`    allowedIdentities: ${allowedExpr},`);
    lines.push(`    unauthenticated: ${e.unauthenticated},`);
    lines.push(`  },`);
  }

  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const stdout = process.argv.includes('--stdout');

  // SKIP_GEN_AUTHZ_REGISTRY=1: trust the committed src/gen/authz/registry.ts
  // and skip regeneration. Same pattern as gen-plans.mjs's SKIP_GEN_PLANS.
  // Used in container builds where the SDK + gibson source trees are not
  // present. The host build runs the full regen + drift gate, so trusting
  // the committed file inside the container is safe.
  if (process.env.SKIP_GEN_AUTHZ_REGISTRY === '1' && existsSync(OUTPUT_PATH)) {
    if (!stdout) {
      process.stdout.write(
        `[gen-authz-registry] SKIP_GEN_AUTHZ_REGISTRY=1, using pre-generated ${OUTPUT_PATH}\n`,
      );
    }
    return;
  }

  if (!stdout) {
    process.stdout.write('[gen-authz-registry] Building proto FileDescriptorSets (workspace synthesis)...\n');
  }

  let ws;
  try {
    // Synthesize workspace.
    ({ ws } = buildWorkspace());

    if (!stdout) {
      process.stdout.write(`[gen-authz-registry] Workspace at ${ws}\n`);
      process.stdout.write('[gen-authz-registry] Building sdk-proto FDS...\n');
    }

    // Build each FDS from within the workspace. Fails loudly if any tree
    // fails to build or produces zero file descriptors.
    const sdkFDS = buildFDSFromWorkspace(ws, 'sdk-proto', 'sdk-proto');

    if (!stdout) {
      process.stdout.write('[gen-authz-registry] Building platform-sdk-proto FDS...\n');
    }

    const platformFDS = buildFDSFromWorkspace(ws, 'platform-sdk-proto', 'platform-sdk-proto');

    // Scan both trees for authz annotations.
    const sdkEntries = scanFDS(sdkFDS);
    const platformEntries = scanFDS(platformFDS);

    // Detect cross-tree method-name collisions (defense-in-depth gate).
    // Same fully-qualified method with conflicting annotation data = fatal.
    // Order of authority: sdk > platform-sdk.
    const sdkByMethod = new Map(sdkEntries.map((e) => [e.method, e]));
    for (const pe of platformEntries) {
      const se = sdkByMethod.get(pe.method);
      if (se) {
        const seKey = `${se.relation}|${se.objectType}|${se.objectDeriver}|${se.allowedIdentities}|${se.unauthenticated}`;
        const peKey = `${pe.relation}|${pe.objectType}|${pe.objectDeriver}|${pe.allowedIdentities}|${pe.unauthenticated}`;
        if (seKey !== peKey) {
          process.stderr.write(
            `[gen-authz-registry] FATAL: conflicting annotations for ${pe.method}\n` +
              `  sdk-proto:          ${seKey}\n` +
              `  platform-sdk-proto: ${peKey}\n`,
          );
          process.exit(1);
        }
      }
    }

    // Merge: SDK entries first, then platform-sdk. De-dup on method name
    // (sdk wins on collision with identical annotations, per above check).
    const seenMethods = new Set(sdkEntries.map((e) => e.method));
    const allEntries = [...sdkEntries];
    for (const pe of platformEntries) {
      if (!seenMethods.has(pe.method)) {
        seenMethods.add(pe.method);
        allEntries.push(pe);
      }
    }

    if (!stdout) {
      process.stdout.write(
        `[gen-authz-registry] Found ${allEntries.length} annotated methods ` +
          `(sdk: ${sdkEntries.length}, platform-sdk: ${platformEntries.length}).\n`,
      );
    }

    const ts = generateTS(allEntries);

    if (stdout) {
      process.stdout.write(ts);
    } else {
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, ts, 'utf8');
      process.stdout.write(`[gen-authz-registry] Wrote ${OUTPUT_PATH}\n`);
    }
  } finally {
    // Always clean up the workspace, whether success or failure.
    if (ws) {
      rmSync(ws, { recursive: true, force: true });
    }
  }
}

main();
