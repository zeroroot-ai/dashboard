// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * docker/entrypoint.sh derives --max-old-space-size from the cgroup memory
 * limit (dashboard#150). These cases run the real script under `sh` with
 * CGROUP_MEMORY_MAX pointed at a fixture file and read back NODE_OPTIONS.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The script runs by a fixed relative path from the repository root, so the
// command line holds no path that comes from the environment.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT = "./docker/entrypoint.sh";

function runWithLimit(contents, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "entrypoint-heap-"));
  const file = join(dir, "memory.max");
  if (contents !== null) writeFileSync(file, contents);
  const result = spawnSync("sh", [ENTRYPOINT, "sh", "-c", 'printf "%s" "${NODE_OPTIONS:-}"'], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH, CGROUP_MEMORY_MAX: file, ...extraEnv },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("a 1Gi limit hands Node three quarters of it", () => {
  assert.equal(runWithLimit("1073741824\n"), "--max-old-space-size=768");
});

test("a 2Gi limit scales with the limit", () => {
  assert.equal(runWithLimit("2147483648\n"), "--max-old-space-size=1536");
});

test("a tiny limit floors the heap at 128MB", () => {
  assert.equal(runWithLimit("67108864\n"), "--max-old-space-size=128");
});

test("an unlimited cgroup sets nothing", () => {
  assert.equal(runWithLimit("max\n"), "");
});

test("a cgroup v1 no-limit sentinel sets nothing", () => {
  assert.equal(runWithLimit("9223372036854771712\n"), "");
});

test("a missing limit file sets nothing", () => {
  assert.equal(runWithLimit(null), "");
});

test("an existing NODE_OPTIONS is kept ahead of the heap flag", () => {
  assert.equal(
    runWithLimit("1073741824\n", { NODE_OPTIONS: "--enable-source-maps" }),
    "--enable-source-maps --max-old-space-size=768",
  );
});
