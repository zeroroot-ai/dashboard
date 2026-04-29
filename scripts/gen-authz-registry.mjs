#!/usr/bin/env node
/**
 * Generate src/gen/authz/registry.ts from SDK proto FileDescriptorSet.
 *
 * Reads every service method in the SDK protos, decodes the
 * (gibson.auth.v1.authz) extension (field 50001 on MethodOptions), and emits
 * a TypeScript module with the AuthEntry type, IdentityClass constants, and
 * AuthRegistry record.
 *
 * Spec: dashboard-authz-ui-gating Requirement 1.
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

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromBinary } from '@bufbuild/protobuf';
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
const SDK_PROTO_DIR = resolve(DASHBOARD_ROOT, '../../../core/sdk/api/proto');
const DAEMON_PROTO_DIR = resolve(DASHBOARD_ROOT, '../../../core/gibson/internal/daemon/api');
const OUTPUT_PATH = resolve(DASHBOARD_ROOT, 'src/gen/authz/registry.ts');

// Extension field number for (gibson.auth.v1.authz) on MethodOptions.
// Hard-coded per spec: "Field number 50001 is reserved for Gibson's authorization
// annotations and MUST NOT change."
const AUTHZ_EXTENSION_FIELD = 50001;

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
// FDS scan
// ---------------------------------------------------------------------------

/**
 * Run `buf build --as-file-descriptor-set` against `protoDir` and return the
 * parsed FileDescriptorSet, or null if the directory does not exist.
 */
function buildFDS(protoDir) {
  try {
    const raw = execFileSync(
      'npx',
      ['buf', 'build', '--as-file-descriptor-set', '-o', '-', protoDir],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return fromBinary(FileDescriptorSetSchema, raw);
  } catch (err) {
    // Non-fatal: the daemon API dir may not be present in all checkouts.
    process.stderr.write(
      `[gen-authz-registry] Warning: buf build failed for ${protoDir}: ${err.message}\n`,
    );
    return null;
  }
}

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

  if (!stdout) {
    process.stdout.write('[gen-authz-registry] Building proto FileDescriptorSet...\n');
  }

  const allEntries = [];
  const seenMethods = new Set();

  for (const dir of [SDK_PROTO_DIR, DAEMON_PROTO_DIR]) {
    const fds = buildFDS(dir);
    if (!fds) continue;
    for (const e of scanFDS(fds)) {
      if (!seenMethods.has(e.method)) {
        seenMethods.add(e.method);
        allEntries.push(e);
      }
    }
  }

  if (!stdout) {
    process.stdout.write(
      `[gen-authz-registry] Found ${allEntries.length} annotated methods.\n`,
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
}

main();
