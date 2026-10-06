// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * artifact-dir.ts, the one place a spec writes a file that another process
 * reads (dashboard#12).
 *
 * The files hold signed-in browser state, so they never go to a fixed name in
 * the shared /tmp, where another local user could read a session cookie or
 * plant a symlink first (CodeQL js/insecure-temporary-file). The orchestrator
 * makes a private directory and passes it as E2E_ARTIFACT_DIR, and reads the
 * files from there. With no E2E_ARTIFACT_DIR the helper makes a private
 * directory with mkdtemp, so a local run is safe by default.
 *
 * The file names are a contract with the Go half in zeroroot-ai/gibson
 * (tests/e2e/login_full_chain_test.go, gibson#215). Change both together.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let resolved: string | null = null;

/** The directory of this run. It is made once, with mode 0700. */
export function artifactDir(): string {
  if (resolved) return resolved;
  const fromEnv = process.env.E2E_ARTIFACT_DIR?.trim();
  if (fromEnv) {
    mkdirSync(fromEnv, { recursive: true, mode: 0o700 });
    resolved = fromEnv;
  } else {
    resolved = mkdtempSync(join(tmpdir(), "dashboard-e2e-"));
  }
  return resolved;
}

/** The path of one artifact of this run. */
export function artifactPath(name: string): string {
  if (name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`artifact name must be a plain file name: ${name}`);
  }
  return join(artifactDir(), name);
}

/** Writes `value` as JSON to the artifact `name`, readable by the owner only. */
export function writeArtifact(name: string, value: unknown): string {
  const path = artifactPath(name);
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  return path;
}
