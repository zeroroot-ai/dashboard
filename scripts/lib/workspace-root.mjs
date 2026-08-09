/**
 * Polyrepo sibling resolution for the dashboard's build scripts.
 *
 * ## Why this exists
 *
 * Six scripts needed to reach a file in a sibling repo (`deploy`'s plans.yaml,
 * the `sdk` proto tree, the gibson daemon-local proto tree, …). Each one
 * encoded the workspace layout as a path-depth count:
 *
 * ```js
 * const isWorktree = DASHBOARD_ROOT.includes("/.worktrees/");
 * const MAIN = isWorktree ? DASHBOARD_ROOT.replace(/\/\.worktrees\/[^/]+$/, "") : DASHBOARD_ROOT;
 * const REPO_ROOT = resolve(MAIN, "..", "..", "..");
 * ```
 *
 * That is correct for exactly two layouts: the main checkout at
 * `<workspace>/enterprise/platform/dashboard`, and a worktree nested at
 * `<dashboard>/.worktrees/<name>`. From a worktree anywhere else — say
 * `<workspace>/.worktrees/<name>` — the rewind is a no-op and the three-level
 * walk lands on `/home`, producing
 * `/home/enterprise/deploy/helm/gibson-operators/files/plans.yaml`. See
 * dashboard#1015. Nesting the worktree to satisfy the counter then breaks
 * eslint, so no location satisfied both checks.
 *
 * ## What replaces it
 *
 * Search upward for the artifact instead of counting directory levels. Walk
 * from the starting directory to the filesystem root and take the first
 * ancestor under which the requested workspace-relative path actually exists.
 * A wrong ancestor cannot produce a false positive, because the predicate is
 * "the file is there", not "the depth looks right".
 *
 * This is layout-agnostic: it works from the main checkout, from a worktree
 * nested inside the dashboard, from a worktree at the workspace root, and from
 * any future layout — including whatever the workspace moves to next, which is
 * the point (it already moved once with the open-core consolidation).
 *
 * `GIBSON_WORKSPACE_ROOT` overrides the search when set. An explicit override
 * is never silently ignored: if the artifact is not under it, resolution fails
 * rather than falling back to the walk, so a typo surfaces instead of
 * mysteriously working.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const WORKSPACE_ROOT_ENV = "GIBSON_WORKSPACE_ROOT";

/**
 * Paths that, relative to a directory, identify it as the polyrepo workspace
 * root. Used only to name the root in diagnostics and to answer "is there a
 * workspace here at all"; actual artifact resolution never relies on these,
 * it looks for the artifact itself.
 *
 * Several anchors, ORed, so a partial clone set still resolves.
 */
const WORKSPACE_ANCHORS = [
  "enterprise/platform/dashboard",
  "enterprise/platform/gibson",
  "enterprise/deploy",
  "opensource/sdk",
];

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

/**
 * Resolve one workspace-relative path to an absolute path.
 *
 * @param {string} relPath  path relative to the workspace root, e.g.
 *   "enterprise/deploy/helm/gibson-operators/files/plans.yaml". May name a
 *   file or a directory.
 * @param {{from?: string, exists?: (p: string) => boolean}} [opts]
 *   `from` is the directory to start the upward walk at; defaults to the
 *   current working directory. `exists` is injectable for tests.
 * @returns {{path: string, workspaceRoot: string, via: "env" | "search"} | null}
 *   null when the artifact is not reachable from any ancestor.
 */
export function resolveWorkspacePath(relPath, opts = {}) {
  const { from = process.cwd(), exists = existsSync } = opts;

  const forced = envRoot();
  if (forced !== null) {
    const candidate = join(forced, relPath);
    // Deliberately no fallback to the search: an explicit override that does
    // not hold must fail loudly.
    return exists(candidate)
      ? { path: candidate, workspaceRoot: forced, via: "env" }
      : null;
  }

  for (const dir of ancestorsOf(from)) {
    const candidate = join(dir, relPath);
    if (exists(candidate)) {
      return { path: candidate, workspaceRoot: dir, via: "search" };
    }
  }
  return null;
}

/**
 * Same as resolveWorkspacePath but throws a diagnostic naming every directory
 * that was tried, instead of returning null.
 *
 * @param {string} relPath
 * @param {{from?: string, exists?: (p: string) => boolean, hint?: string}} [opts]
 * @returns {string} absolute path
 */
export function requireWorkspacePath(relPath, opts = {}) {
  const { from = process.cwd(), exists = existsSync, hint } = opts;
  const found = resolveWorkspacePath(relPath, { from, exists });
  if (found) return found.path;

  const forced = envRoot();
  const lines = [`cannot locate ${relPath} in the polyrepo workspace.`];
  if (forced !== null) {
    lines.push(
      `${WORKSPACE_ROOT_ENV} is set to ${forced}, and ${join(forced, relPath)} does not exist.`,
      `Unset ${WORKSPACE_ROOT_ENV} to search upward from the checkout instead.`,
    );
  } else {
    lines.push(
      `Searched upward from ${resolve(from)}:`,
      ...ancestorsOf(from).map((d) => `  ${join(d, relPath)}`),
      `Clone the sibling repo into your workspace, or set ${WORKSPACE_ROOT_ENV}`,
      "to the directory the sibling repos hang off.",
    );
  }
  if (hint) lines.push(hint);
  throw new Error(lines.join("\n"));
}

/**
 * Best-effort location of the workspace root itself, for diagnostics and for
 * callers that need the root rather than one artifact under it.
 *
 * @param {{from?: string, exists?: (p: string) => boolean}} [opts]
 * @returns {string | null}
 */
export function findWorkspaceRoot(opts = {}) {
  const { from = process.cwd(), exists = existsSync } = opts;
  const forced = envRoot();
  if (forced !== null) return forced;
  for (const dir of ancestorsOf(from)) {
    if (WORKSPACE_ANCHORS.some((a) => exists(join(dir, a)))) return dir;
  }
  return null;
}
