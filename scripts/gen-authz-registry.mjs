#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Generate src/gen/authz/registry.ts from the SDK and gibson daemon-local
 * proto FileDescriptorSets.
 *
 * Reads every service method in both proto sources, decodes the
 * (gibson.auth.v1.authz) extension (field 50001 on MethodOptions), and emits
 * a TypeScript module with the AuthEntry type, IdentityClass constants, and
 * AuthRegistry record.
 *
 * Workspace synthesis
 * -------------------
 * Buf v2 has a hard rule that every module path in buf.yaml must resolve INSIDE
 * the directory containing the buf.yaml. The gibson daemon-local protos live
 * outside this dashboard repo, so they cannot be referenced with ../../ paths.
 * Instead, this script synthesises a temporary workspace at .tmp/proto-ws/
 * (same pattern as proto-generate.mjs), puts a symlink in it, and runs buf
 * build from inside that workspace. The workspace is always cleaned up in a
 * finally block.
 *
 * The SDK protos need no symlink. They come from the Buf Schema Registry at
 * the release that scripts/lib/sdk-proto-source.mjs names (ADR-0028). No sdk
 * checkout and no Go module cache is read.
 *
 * Two proto sources
 * -----------------
 * 1. sdk          , OSS SDK (DaemonService, the enrollment services, etc.),
 *                   the registry module at its pinned release.
 * 2. gibson-local , gibson daemon-local protos at
 *                   internal/server/daemon/api in the gibson repository.
 *                   Hosts the daemon-internal services (TracesService,
 *                   session, world, user) AND the PRIVATE platform services
 *                   that used to live in platform-sdk: DaemonOperatorService
 *                   (gibson.daemon.operator.v1), BillingService
 *                   (gibson.billing.v1), DiscoveryService
 *                   (gibson.daemon.discovery.v1). platform-sdk was dissolved
 *                   in gibson#781 (open-core monorepo consolidation,
 *                   ADR-0056).
 *
 * This ensures operator/billing/discovery service methods are present in the
 * registry for the assertAuthorized / useAuthorize gating layer.
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
 * output for the same proto input, the drift gate relies on this.
 */

// spawnSync only: every child process here is spawned with an argv
// array and no shell, so an interpolated path or module name can never be
// reparsed as shell syntax. See scripts/proto-generate.mjs's run() for the full
// rationale.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromBinary } from '@bufbuild/protobuf';
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt';
import { SDK_BSR_REF } from './lib/sdk-proto-source.mjs';
import { resolveRepoPath } from './lib/workspace-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
const WS = resolve(DASHBOARD_ROOT, '.tmp/proto-ws');
const OUTPUT_PATH = resolve(DASHBOARD_ROOT, 'src/gen/authz/registry.ts');

// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. `go.mod` is the marker that
// proves a candidate directory really is the gibson repository.
const GIBSON_REPO_MARKER = 'go.mod';
// GIBSON_PROTO_REPO overrides the resolved gibson root so a local regen can
// read a checkout or git worktree that already carries a proto not yet on the
// resolved sibling's HEAD, e.g. a just-merged feature branch checked out
// separately. Unset in CI, where the resolved sibling is the source of truth;
// when both trees carry the same protos the generated output is byte-identical,
// so the override never changes CI's result. dashboard#1116.
const GIBSON_REPO = process.env.GIBSON_PROTO_REPO?.trim()
  ? resolve(process.env.GIBSON_PROTO_REPO)
  : (resolveRepoPath('gibson', GIBSON_REPO_MARKER, { from: DASHBOARD_ROOT })
      ?.repoRoot ?? resolve(DASHBOARD_ROOT, 'gibson'));
// gibson daemon-local proto tree (post-#787 reorg location). It hosts the
// daemon-internal services and the PRIVATE platform services
// (DaemonOperatorService, BillingService, DiscoveryService) that used to
// live in platform-sdk before it was dissolved (gibson#781). These
// namespaces must be present in the AuthRegistry so assertAuthorized /
// useAuthorize can gate access to those RPCs.
const GIBSON_LOCAL_PROTOS = resolve(GIBSON_REPO, 'internal/server/daemon/api');

// Extension field number for (gibson.auth.v1.authz) on MethodOptions.
// Hard-coded per spec: "Field number 50001 is reserved for Gibson's authorization
// annotations and MUST NOT change."
const AUTHZ_EXTENSION_FIELD = 50001;

// ---------------------------------------------------------------------------
// Workspace synthesis (same pattern as proto-generate.mjs)
// ---------------------------------------------------------------------------

function ensureGibsonLocalProtos({ soft = false } = {}) {
  // Presence is a filesystem question, so existsSync answers it in process.
  if (existsSync(GIBSON_LOCAL_PROTOS)) return true;
  if (soft) return false;
  process.stderr.write(
    '[gen-authz-registry] FATAL: gibson daemon-local protos not found at:\n' +
      `    ${GIBSON_LOCAL_PROTOS}\n` +
      '  Clone zeroroot-ai/gibson alongside this dashboard checkout, or\n' +
      '  run from the canonical workspace at ~/Code/zeroroot.ai/.\n',
  );
  process.exit(1);
}

/**
 * Report whether the daemon-local proto tree is reachable, as JSON on stdout.
 * `check-authz-registry-fresh.mjs` uses this to decide between a full
 * byte-diff and a structural-only pass, so the generator that owns the path
 * is the only thing that has to know it. Same contract as
 * `proto-generate.mjs --probe`. The SDK protos are a registry reference, not
 * a path on the disk, so they do not decide the mode.
 */
function probe() {
  const gibsonLocalProtos = ensureGibsonLocalProtos({ soft: true })
    ? GIBSON_LOCAL_PROTOS
    : null;
  process.stdout.write(
    JSON.stringify(
      {
        gibsonRepo: existsSync(GIBSON_REPO) ? GIBSON_REPO : null,
        sources: { sdkModule: SDK_BSR_REF, gibsonLocalProtos },
        available: Boolean(gibsonLocalProtos),
      },
      null,
      2,
    ) + '\n',
  );
}

/**
 * Build the .tmp/proto-ws/ workspace: one symlink to the gibson daemon-local
 * proto tree, and the SDK registry module as a dependency.
 *
 *   gibson-local , gibson daemon-local protos (TracesService, session,
 *                  world, user) + PRIVATE platform services
 *                  (DaemonOperatorService, BillingService, DiscoveryService)
 *                  ex-platform-sdk, dissolved in gibson#781.
 */
function buildWorkspace() {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });

  ensureGibsonLocalProtos();

  // The symlink brings the daemon-local proto tree inside the buf.yaml's
  // context directory. Buf v2 follows symlinks; this satisfies the "modules
  // must be inside the workspace" rule without copying files.
  symlinkSync(GIBSON_LOCAL_PROTOS, resolve(WS, 'gibson-local'));

  writeFileSync(
    resolve(WS, 'buf.yaml'),
    [
      'version: v2',
      'modules:',
      // gibson-local is the daemon-internal proto tree. It owns the
      // daemon-internal services and the PRIVATE platform services
      // (operator/billing/discovery) ex-platform-sdk (gibson#781).
      // gibson/auth/v1/options.proto is the annotation extension; it lives
      // canonically in the OSS SDK and is imported (not vendored) by the
      // daemon-local protos. Exclude it here so buf does not see a second
      // copy next to the one in the SDK registry module.
      '  - path: gibson-local',
      '    excludes:',
      '      - gibson-local/gibson/auth',
      // Scope the gibson-local authz scan to the ex-platform-sdk platform
      // services (operator / billing / discovery) PLUS world: the dashboard's
      // World/traces surface calls assertAuthorized on gibson.world.v1.WorldService
      // reads (ListMissions, ListLlmCalls, GetFrameAt, …), so those methods must
      // be surfaced into the registry — otherwise assertAuthorized fail-closes
      // them as unknown_method (the "world read failed (500)" the dashboard shows).
      // session/user stay unsurfaced until the dashboard gates them. Context:
      // platform-sdk dissolution (gibson#781); world surfaced for the ecs-brain
      // read path.
      '      - gibson-local/gibson/session',
      '      - gibson-local/gibson/user',
      // The SDK protos, at the pinned release. The daemon-local protos import
      // them. protovalidate provides the (buf.validate.field).* annotations
      // that the SDK protos use. `buf dep update` below resolves both.
      'deps:',
      `  - ${SDK_BSR_REF}`,
      '  - buf.build/bufbuild/protovalidate',
      'lint:',
      '  use:',
      '    - STANDARD',
      '  ignore:',
      '    - gibson-local',
      '',
    ].join('\n'),
  );

  // Resolve the two registry deps declared in buf.yaml. Writes a buf.lock
  // alongside the generated buf.yaml, which pins each dep to one commit and
  // one digest for the `buf build` below.
  //
  // There is no offline path. The SDK protos are in the registry only, so a
  // run that cannot reach it stops here. It never reads a checkout in place
  // of the registry.
  const dep = spawnSync('npx', ['buf', 'dep', 'update'], { cwd: WS });
  if (dep.status !== 0) {
    const stderr = dep.stderr ? dep.stderr.toString('utf8') : '(no stderr)';
    process.stderr.write(
      `[gen-authz-registry] FATAL: \`buf dep update\` failed, so ${SDK_BSR_REF} did not resolve.\n` +
        '  The SDK protos come from the Buf Schema Registry (ADR-0028).\n' +
        '  Make sure that this host reaches buf.build and that the release exists.\n' +
        `  ${stderr}\n`,
    );
    rmSync(WS, { recursive: true, force: true });
    process.exit(1);
  }

  return WS;
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
 *   6 = self (bool): the caller reads its own data; no FGA tuple to check
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
    self: false,
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
      else if (fieldNo === 6) result.self = v !== 0;
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
 * Run `buf build --as-file-descriptor-set` for `input` from inside the
 * workspace directory. Exits the process on failure or empty result. Returns
 * the parsed FileDescriptorSet.
 *
 * @param {string} ws     - Absolute path to the workspace (.tmp/proto-ws/).
 * @param {string} input  - A module path relative to ws ("gibson-local"), or
 *                          a registry module reference (SDK_BSR_REF).
 * @param {string} label  - Human-readable label for error messages.
 */
function buildFDS(ws, input, label) {
  const result = spawnSync(
    'npx',
    ['buf', 'build', '--as-file-descriptor-set', '-o', '-', input],
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
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS, is the proto source present?\n`,
    );
    process.exit(1);
  }

  const fds = fromBinary(FileDescriptorSetSchema, raw);

  if (!fds.file || fds.file.length === 0) {
    process.stderr.write(
      `[gen-authz-registry] FATAL: ${label} produced an empty FDS, is the proto source present?\n`,
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
  lines.push('  /** Self-mode (gibson.auth.v1 AuthOptions.self): an authenticated caller reading its own data. No tenant relation applies. */');
  lines.push('  self: boolean;');
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
    lines.push(`    self: ${e.self},`);
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

  if (process.argv.includes('--probe')) {
    probe();
    return;
  }

  // SKIP_GEN_AUTHZ_REGISTRY=1: trust the committed src/gen/authz/registry.ts
  // and skip regeneration. Same pattern as gen-plans.mjs's SKIP_GEN_PLANS.
  // Used in container builds where the SDK + gibson source trees are not
  // present. The host build runs the full regen + drift gate, so trusting
  // the committed file inside the container is safe.
  //
  // Never honored in --stdout mode: that mode exists for the drift gate,
  // which needs real generator output. Returning early there would emit an
  // empty capture and the gate would read it as drift. (gen-plans.mjs guards
  // its SKIP the same way; this one did not, and would have started lying the
  // moment the gate's own SKIP escape was removed in dashboard#1019.)
  if (!stdout && process.env.SKIP_GEN_AUTHZ_REGISTRY === '1' && existsSync(OUTPUT_PATH)) {
    process.stdout.write(
      `[gen-authz-registry] SKIP_GEN_AUTHZ_REGISTRY=1, using pre-generated ${OUTPUT_PATH}\n`,
    );
    return;
  }

  if (!stdout) {
    process.stdout.write('[gen-authz-registry] Building proto FileDescriptorSets (workspace synthesis)...\n');
  }

  let ws;
  try {
    // Synthesize workspace.
    ws = buildWorkspace();

    if (!stdout) {
      process.stdout.write(`[gen-authz-registry] Workspace at ${ws}\n`);
      process.stdout.write(`[gen-authz-registry] Building the SDK FDS from ${SDK_BSR_REF}...\n`);
    }

    // Build each FDS from within the workspace. Fails loudly if any source
    // fails to build or produces zero file descriptors. The SDK set comes
    // from the registry module itself, so it holds each service of the SDK
    // and not only the files that the daemon-local protos import.
    const sdkFDS = buildFDS(ws, SDK_BSR_REF, 'sdk');

    if (!stdout) {
      process.stdout.write('[gen-authz-registry] Building gibson-local FDS...\n');
    }

    const gibsonFDS = buildFDS(ws, 'gibson-local', 'gibson-local');

    // Scan both sources for authz annotations.
    const sdkEntries = scanFDS(sdkFDS);
    const gibsonEntries = scanFDS(gibsonFDS);

    // Detect cross-tree method-name collisions (defense-in-depth gate).
    // Same fully-qualified method with conflicting annotation data = fatal.
    // Order of authority: sdk > gibson-local.
    const sdkByMethod = new Map(sdkEntries.map((e) => [e.method, e]));
    for (const ge of gibsonEntries) {
      const se = sdkByMethod.get(ge.method);
      if (se) {
        const seKey = `${se.relation}|${se.objectType}|${se.objectDeriver}|${se.allowedIdentities}|${se.unauthenticated}|${se.self}`;
        const geKey = `${ge.relation}|${ge.objectType}|${ge.objectDeriver}|${ge.allowedIdentities}|${ge.unauthenticated}|${ge.self}`;
        if (seKey !== geKey) {
          process.stderr.write(
            `[gen-authz-registry] FATAL: conflicting annotations for ${ge.method}\n` +
              `  sdk:          ${seKey}\n` +
              `  gibson-local: ${geKey}\n`,
          );
          process.exit(1);
        }
      }
    }

    // Merge: SDK entries first, then gibson-local. De-dup on method name
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
