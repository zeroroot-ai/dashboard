#!/usr/bin/env node
/**
 * security-lint.mjs — the dashboard's single security-lint preset.
 *
 * dashboard#816 (E9): after the typed daemon boundary landed (single
 * ConnectRPC transport — dashboard#814; branded TenantId — dashboard#815;
 * zero side-channels to Loki/IAM/K8s — dashboard#811/#812/#855), the
 * historical ~47 reactive prebuild grep-guards were re-classified. The
 * guards whose invariant is now a COMPILE error or a missing module were
 * deleted (see the PR for the proof). The guards that remain catch a
 * runtime/semantic invariant the TypeScript compiler genuinely cannot —
 * a leaked secret in a log line or a client bundle, an env-var name that
 * must never be wired, a `process.env` API-key read, a raw `fetch()` to
 * the IdP outside the audited adapter, a daemon host:port literal, an
 * authz call missing from a server action, an over-broad RBAC verb.
 *
 * This module gathers those genuinely-security guards into ONE preset so
 * the `pnpm prebuild` chain (and a standalone `pnpm check:security-lint`)
 * expresses the dashboard↔gibson security contract in a single named
 * entry instead of two dozen inline `&&` invocations.
 *
 * IMPORTANT: this is a *runner*, not a reimplementation. Each guard below
 * is spawned exactly as it ran before (same script, same args, same cwd,
 * stdio inherited). Behaviour is preserved byte-for-byte: any guard that
 * exits non-zero fails the preset with that guard's own output. No check
 * is weakened, reordered into a wrong dependency, or silently skipped.
 *
 * Run:
 *   node scripts/security-lint.mjs            # run every guard, fail on first/any
 *   node scripts/security-lint.mjs --list     # print the guard set and exit 0
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_NAME = 'security-lint.mjs';
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The security-boundary guard set. Each entry is `[scriptFile, ...args]`.
 * Order is preserved exactly as it was in the prebuild chain so any
 * (intentional) ordering coupling is unchanged. These guards enforce the
 * dashboard↔gibson security contract: no permissive/escape-hatch auth, no
 * NODE_ENV-conditioned auth, no debug routes enabled by committed config,
 * no LLM-credential reads, no direct K8s provider-secret access, no
 * IAM-admin PAT, no raw IdP fetch, no direct daemon channel, exactly one
 * daemon transport, no deleted admin-RPC bindings, no SPIFFE collapse in
 * the user client, no leaked secret in the client bundle.
 *
 * Each of these catches a runtime/semantic invariant the compiler cannot:
 * string-literal env-var names, `process.env` reads, host:port literals,
 * package.json dependency declarations, fetch-call proximity, or compiled
 * bundle scans — none of which is a TypeScript type error.
 */
const GUARDS = [
  ['check-no-permissive-flags.mjs'],
  ['check-no-nodeenv-conditioned-auth.mjs'],
  ['check-no-prod-debug-flags.mjs'],
  ['check-no-llm-credential-reads.mjs'],
  ['check-no-provider-k8s-access.mjs'],
  ['check-no-iam-admin-pat-in-dashboard.mjs'],
  ['check-no-direct-zitadel-fetch.mjs'],
  ['check-no-direct-daemon-grpc.mjs'],
  ['check-single-daemon-transport.mjs'],
  ['check-no-direct-admin-rpc.mjs'],
  ['check-no-spiffe-in-user-client.mjs'],
  ['check-no-secrets-in-client.mjs'],
];

if (process.argv.includes('--list')) {
  console.log(`[${SCRIPT_NAME}] security-lint preset (${GUARDS.length} guards):`);
  for (const [file, ...args] of GUARDS) {
    console.log(`  - ${file}${args.length ? ' ' + args.join(' ') : ''}`);
  }
  process.exit(0);
}

let failed = 0;
for (const [file, ...args] of GUARDS) {
  const scriptPath = path.join(SCRIPTS_DIR, file);
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    failed += 1;
    console.error(`[${SCRIPT_NAME}] FAIL: ${file} exited ${res.status}`);
    // Fail fast — same as the `&&` chain it replaces.
    process.exit(res.status === null ? 1 : res.status);
  }
}

if (failed === 0) {
  console.log(`[${SCRIPT_NAME}] OK: all ${GUARDS.length} security guards passed.`);
}
process.exit(failed === 0 ? 0 : 1);
