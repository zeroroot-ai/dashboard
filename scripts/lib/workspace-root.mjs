// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Sibling-repository resolution for the dashboard's build scripts.
 *
 * ## What a caller asks for
 *
 * A repository NAME and a path INSIDE that repository:
 *
 * ```js
 * requireRepoPath("charts", "helm/gibson-operators/files/plans.yaml");
 * requireRepoPath("sdk", "gen/mission-definition.schema.json");
 * ```
 *
 * Both halves are durable. `charts` is `github.com/zeroroot-ai/charts`, and
 * `helm/gibson-operators/files/plans.yaml` is a path in that repository. No
 * caller states where the clones sit on any particular machine.
 *
 * ## Where the resolver looks
 *
 * It walks up from this checkout. At each ancestor it descends through GROUPING
 * directories, up to two levels, and takes the first directory named after the
 * repository that actually contains the requested path.
 *
 * A grouping directory is any directory that is not itself a checkout, so the
 * descent never enters another repository's tree. Dot-directories, build output
 * and `node_modules` are never entered either, and the descent carries a budget
 * so a miss cannot turn into a filesystem crawl.
 *
 * That rule covers every layout the workspace has used and the obvious ones it
 * has not: repositories side by side, repositories under one or two grouping
 * directories, this checkout in a `.worktrees/<name>` directory at any level.
 * It never counts `..` segments and it never names a grouping directory, so
 * moving the clones needs no edit here.
 *
 * The predicate is "the requested path is under this directory", so a directory
 * that happens to share a repository name but holds nothing is skipped rather
 * than returned.
 *
 * ## The one override
 *
 * `GIBSON_WORKSPACE_ROOT` replaces the ancestor walk with the single directory
 * it names. The same descent applies under it, so a scratch root of symlinks
 * works:
 *
 * ```
 * $ROOT/gibson -> …          # a child
 * $ROOT/oss/sdk -> …         # under one grouping directory
 * ```
 *
 * An override that does not hold FAILS. It never falls back to the walk, so a
 * typo surfaces instead of mysteriously working.
 *
 * ## Never reintroduce a depth count
 *
 * `resolve(root, "..", "..", "..")` and `path.includes("/.worktrees/")` are the
 * exact bug this replaced. Unit tests covering every layout live in
 * `scripts/lib/workspace-root.test.mjs`.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const WORKSPACE_ROOT_ENV = "GIBSON_WORKSPACE_ROOT";

/** Directory names that never group sibling checkouts. */
const NEVER_A_GROUP = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
]);

/** How many grouping directories the descent may pass through. */
const MAX_GROUP_DEPTH = 2;

/** Directories the descent may examine per starting point. */
const SEARCH_BUDGET = 256;

/** Every directory from `start` up to the filesystem root, inclusive. */
export function ancestorsOf(start) {
  const out = [];
  let dir = resolve(start);
  for (;;) {
    out.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return out;
    dir = parent;
  }
}

function envRoot() {
  const raw = process.env[WORKSPACE_ROOT_ENV];
  if (!raw || raw.trim() === "") return null;
  const value = raw.trim();
  if (!isAbsolute(value)) {
    throw new Error(
      `${WORKSPACE_ROOT_ENV} must be an absolute path, got ${JSON.stringify(value)}`,
    );
  }
  return resolve(value);
}

function defaultListDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() && !e.name.startsWith(".") && !NEVER_A_GROUP.has(e.name),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Every directory that could be the `repo` checkout, nearest first.
 *
 * @param {string} repo
 * @param {string[]} bases  starting points, nearest first
 * @param {(dir: string) => string[]} listDirs
 * @param {(dir: string) => boolean} isCheckout
 */
function* candidateRoots(repo, bases, listDirs, isCheckout) {
  for (const base of bases) {
    let frontier = [base];
    let budget = SEARCH_BUDGET;
    for (let depth = 0; depth <= MAX_GROUP_DEPTH; depth += 1) {
      const next = [];
      for (const dir of frontier) {
        yield join(dir, repo);
        if (depth === MAX_GROUP_DEPTH || budget <= 0) continue;
        // Descend through grouping directories only. A directory that is
        // itself a checkout holds another repository's tree, never a sibling.
        if (isCheckout(dir)) continue;
        for (const name of listDirs(dir)) {
          if (budget <= 0) break;
          budget -= 1;
          if (name === repo) continue;
          next.push(join(dir, name));
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
  }
}

/**
 * Resolve one path inside a sibling repository.
 *
 * @param {string} repo  repository name, e.g. "charts", "sdk", "gibson", "adk"
 * @param {string} relPath  path inside that repository. May name a file or a
 *   directory. Pass a marker such as "go.mod" when the caller wants the
 *   repository root itself, and read `repoRoot` off the result.
 * @param {{from?: string, exists?: (p: string) => boolean,
 *          listDirs?: (dir: string) => string[]}} [opts]
 *   `from` is the directory the ancestor walk starts at, default the current
 *   working directory. `exists` and `listDirs` are injectable for tests.
 * @returns {{path: string, repoRoot: string, via: "env" | "search"} | null}
 *   null when no candidate holds the requested path.
 */
export function resolveRepoPath(repo, relPath, opts = {}) {
  const {
    from = process.cwd(),
    exists = existsSync,
    listDirs = defaultListDirs,
  } = opts;

  const forced = envRoot();
  const bases = forced !== null ? [forced] : ancestorsOf(from);
  const via = forced !== null ? "env" : "search";
  const isCheckout = (dir) => exists(join(dir, ".git"));

  for (const repoRoot of candidateRoots(repo, bases, listDirs, isCheckout)) {
    const candidate = join(repoRoot, relPath);
    if (exists(candidate)) return { path: candidate, repoRoot, via };
  }
  return null;
}

/**
 * Same as resolveRepoPath, but throws a diagnostic that names what was tried.
 *
 * @param {string} repo
 * @param {string} relPath
 * @param {{from?: string, exists?: (p: string) => boolean,
 *          listDirs?: (dir: string) => string[], hint?: string}} [opts]
 * @returns {string} absolute path
 */
export function requireRepoPath(repo, relPath, opts = {}) {
  const { from = process.cwd(), hint, ...rest } = opts;
  const found = resolveRepoPath(repo, relPath, { from, ...rest });
  if (found) return found.path;

  const forced = envRoot();
  const lines = [
    `cannot locate ${relPath} in a checkout of zeroroot-ai/${repo}.`,
  ];
  if (forced !== null) {
    lines.push(
      `${WORKSPACE_ROOT_ENV} is set to ${forced}, and no ${repo} directory under it holds ${relPath}.`,
      `Put the checkout at ${join(forced, repo)}, or unset ${WORKSPACE_ROOT_ENV}`,
      "to search upward from this checkout instead.",
    );
  } else {
    lines.push(
      `Searched every ancestor of ${resolve(from)} for a ${repo} directory`,
      `holding that path, through at most ${MAX_GROUP_DEPTH} grouping directories.`,
      `Clone zeroroot-ai/${repo} next to this checkout, or set ${WORKSPACE_ROOT_ENV}`,
      "to the directory the checkouts hang off.",
    );
  }
  if (hint) lines.push(hint);
  throw new Error(lines.join("\n"));
}
