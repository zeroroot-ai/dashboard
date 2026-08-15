/**
 * artifact-dir.ts, private per-run directory for e2e diagnostic artifacts.
 *
 * The auth specs dump redirect chains, screenshots, cookie jars and
 * `storageState` files. Several of those carry LIVE signed-in session state, so
 * they must never land on a fixed, world-readable `/tmp/<name>` path: on a
 * shared CI host or a multi-user workstation another local user can pre-plant a
 * symlink there (turning the write into a clobber of any file the test user can
 * write) or simply read the session out of the file.
 *
 * `fs.mkdtempSync` is the right primitive: it creates the directory atomically
 * with mode 0700 and a random suffix the attacker cannot predict, so neither
 * attack works.
 *
 * Cross-process handoff: some artifacts are read back by an out-of-process
 * consumer (the gibson `tests/e2e` Go suite, `deploy/scripts/*-trace.sh`). Those
 * orchestrators create the directory themselves and pass it in via
 * `E2E_ARTIFACT_DIR`; the spec only mints its own when it is running standalone.
 * The env var is a caller-chosen path, so the caller owns its permissions.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Returns the directory every artifact of the current run is written into.
 *
 * `E2E_ARTIFACT_DIR` wins when set (created if missing) so an out-of-process
 * consumer can find the files; otherwise a fresh 0700 `mkdtemp` directory is
 * minted under the OS temp dir.
 */
export function artifactDir(prefix: string): string {
  const fromEnv = process.env.E2E_ARTIFACT_DIR;
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}
