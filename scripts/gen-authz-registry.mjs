#!/usr/bin/env node
/**
 * Generate src/gen/authz/registry.ts from both the SDK proto FileDescriptorSet
 * and the daemon-local proto FileDescriptorSet.
 *
 * Reads every service method in both proto trees, decodes the
 * (gibson.auth.v1.authz) extension (field 50001 on MethodOptions), and emits
 * a TypeScript module with the AuthEntry type, IdentityClass constants, and
 * AuthRegistry record.
 *
 * Workspace synthesis
 * -------------------
 * Buf v2 has a hard rule that every module path in buf.yaml must resolve INSIDE
 * the directory containing the buf.yaml. The SDK protos (resolved from the
 * gibson repo's go.mod) and daemon-local protos live outside this dashboard
 * repo, so they cannot be referenced with ../../ paths. Instead, this script
 * synthesises a temporary workspace at .tmp/proto-ws/ (same pattern as
 * proto-generate.mjs), populates it with symlinks, and runs buf build from
 * inside that workspace. The workspace is always cleaned up in a finally block.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 2.1–2.3.
 *
 * Usage
 * -----
 *   node scripts/gen-authz-registry.mjs            # writes src/gen/authz/registry.ts
 *   node scripts/gen-authz-registry.mjs --stdout   # prints to stdout (for drift gate)
 *
 * Determinism
 * -----------
 * Entries are sorted by method name. The script MUST produce byte-identical
 * output for the same proto input — the drift gate relies on this.
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

// Workspace root: ~/Code/zero-day.ai/. Sibling repos hang off here.
// Gibson lives at enterprise/platform/gibson — the `core/` prefix was the
// pre-refactor layout and is no longer present.
const WORKSPACE_ROOT = resolve(DASHBOARD_ROOT, '..', '..', '..');
const GIBSON_REPO = resolve(WORKSPACE_ROOT, 'enterprise/platform/gibson');
const GIBSON_LOCAL_PROTOS = resolve(GIBSON_REPO, 'internal/daemon/api');

// Extension field number for (gibson.auth.v1.authz) on MethodOptions.
// Hard-coded per spec: "Field number 50001 is reserved for Gibson's authorization
// annotations and MUST NOT change."
const AUTHZ_EXTENSION_FIELD = 50001;

// ---------------------------------------------------------------------------
// Workspace synthesis (verbatim pattern from proto-generate.mjs)
// ---------------------------------------------------------------------------

function resolveSdkProtoDir() {
  try {
    const dir = execSync('go list -m -f "{{.Dir}}" github.com/zero-day-ai/sdk', {
      cwd: GIBSON_REPO,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (!dir) throw new Error('empty');
    return resolve(dir, 'api/proto');
  } catch (err) {
    process.stderr.write(
      '[gen-authz-registry] FATAL: failed to resolve github.com/zero-day-ai/sdk via `go list -m`.\n' +
        '  This script expects the gibson daemon repo cloned at:\n' +
        `    ${GIBSON_REPO}\n` +
        '  with `go.mod` resolving the SDK as a Go module dependency.\n' +
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
        '  Clone zero-day-ai/gibson alongside this dashboard checkout, or\n' +
        '  run from the canonical workspace at ~/Code/zero-day.ai/.\n' +
        `  Underlying error: ${err.message ?? err}\n`,
    );
    process.exit(1);
  }
}

/**
 * Build the .tmp/proto-ws/ workspace with symlinks to both proto trees,
 * exactly mirroring the pattern in proto-generate.mjs.
 */
function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  const sdkProtoDir = resolveSdkProtoDir();
  ensureGibsonLocalProtos();

  // Symlinks bring both proto trees inside the buf.yaml's context directory.
  // Buf v2 follows symlinks; this satisfies the "modules must be inside the
  // workspace" rule without copying files.
  symlinkSync(GIBSON_LOCAL_PROTOS, resolve(WS, 'gibson-local'));
  symlinkSync(sdkProtoDir, resolve(WS, 'sdk-proto'));

  writeFileSync(
    resolve(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      '  - path: gibson-local',
      '  - path: sdk-proto',
      '    excludes:',
      '      - sdk-proto/google',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      '    - gibson-local/gibson/daemon/admin/v1/daemon_admin.proto',
      '',
    ].join('\n'),
  );

  return { ws: WS, sdkProtoDir };
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
      // Unknown wire type — stop parsing this message.
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
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS — is the proto root present?\n`,
    );
    process.exit(1);
  }

  const fds = fromBinary(FileDescriptorSetSchema, raw);

  if (!fds.file || fds.file.length === 0) {
    process.stderr.write(
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS — is the proto root present?\n`,
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
        `[gen-authz-registry] SKIP_GEN_AUTHZ_REGISTRY=1 — using pre-generated ${OUTPUT_PATH}\n`,
      );
    }
    return;
  }

  if (!stdout) {
    process.stdout.write('[gen-authz-registry] Building proto FileDescriptorSets (workspace synthesis)...\n');
  }

  let ws;
  try {
    // Synthesize workspace (verbatim pattern from proto-generate.mjs).
    ({ ws } = buildWorkspace());

    if (!stdout) {
      process.stdout.write(`[gen-authz-registry] Workspace at ${ws}\n`);
      process.stdout.write('[gen-authz-registry] Building sdk-proto FDS...\n');
    }

    // Build each FDS from within the workspace. Fails loudly if either tree
    // fails to build or produces zero file descriptors.
    const sdkFDS = buildFDSFromWorkspace(ws, 'sdk-proto', 'sdk-proto');

    if (!stdout) {
      process.stdout.write('[gen-authz-registry] Building gibson-local FDS...\n');
    }

    const gibsonFDS = buildFDSFromWorkspace(ws, 'gibson-local', 'gibson-local');

    // Scan both trees for authz annotations.
    const sdkEntries = scanFDS(sdkFDS);
    const gibsonEntries = scanFDS(gibsonFDS);

    // Detect cross-tree method-name collisions (defense-in-depth gate).
    // Same fully-qualified method with conflicting annotation data = fatal.
    const sdkByMethod = new Map(sdkEntries.map((e) => [e.method, e]));
    for (const ge of gibsonEntries) {
      const se = sdkByMethod.get(ge.method);
      if (se) {
        // Same method in both trees. Check if annotations differ.
        const seKey = `${se.relation}|${se.objectType}|${se.objectDeriver}|${se.allowedIdentities}|${se.unauthenticated}`;
        const geKey = `${ge.relation}|${ge.objectType}|${ge.objectDeriver}|${ge.allowedIdentities}|${ge.unauthenticated}`;
        if (seKey !== geKey) {
          process.stderr.write(
            `[gen-authz-registry] FATAL: conflicting annotations for ${ge.method}\n` +
              `  sdk-proto:     ${seKey}\n` +
              `  gibson-local:  ${geKey}\n`,
          );
          process.exit(1);
        }
      }
    }

    // Merge: SDK entries first; gibson-local entries de-dup on method name
    // (sdk wins on collision with identical annotations, per above check).
    const seenMethods = new Set(sdkEntries.map((e) => e.method));
    const allEntries = [...sdkEntries];
    for (const ge of gibsonEntries) {
      if (!seenMethods.has(ge.method)) {
        seenMethods.add(ge.method);
        allEntries.push(ge);
      }
    }

    if (!stdout) {
      process.stdout.write(
        `[gen-authz-registry] Found ${allEntries.length} annotated methods ` +
          `(sdk: ${sdkEntries.length}, gibson-local: ${gibsonEntries.length}).\n`,
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
