// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tests for the sibling-repository resolver.
 *
 * Each case builds a real directory tree under a temp dir, so the assertions
 * are about actual filesystem behavior, not a mocked path string. Two layouts
 * are built side by side, a flat one and a grouped one, because the resolver
 * must handle both without naming either grouping directory.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ancestorsOf,
  requireRepoPath,
  resolveRepoPath,
  WORKSPACE_ROOT_ENV,
} from "./workspace-root.mjs";

const PLANS_REL = "helm/gibson-operators/files/plans.yaml";
const SDK_REL = "gen/mission-definition.schema.json";

// The walk reaches shared ancestors such as the temp dir and the filesystem
// root, where a stray checkout could satisfy a real repository name. The
// negative cases use a name that exists nowhere, so "not found" means the
// search genuinely failed rather than the machine happening to be tidy.
const ABSENT_REPO = `charts-absent-${process.pid}`;

/** A workspace whose checkouts sit side by side. */
let flat;
/** A workspace whose checkouts sit one level down, under grouping dirs. */
let grouped;
/** The dashboard checkout in the grouped workspace. */
let mainCheckout;
/** A worktree nested inside that checkout. */
let nestedWorktree;
/** A worktree at the workspace root. */
let workspaceWorktree;
/** A checkout with no sibling repository above it at all. */
let orphanCheckout;
/** A decoy directory that carries the repository name but not the file. */
let decoyWorkspace;

/** Every temp dir built here, torn down in afterAll. */
const scratches = [];

function newScratch(label) {
  const dir = mkdtempSync(join(tmpdir(), `sibling-repo-${label}-`));
  scratches.push(dir);
  return dir;
}

/** A checkout: a directory carrying a .git entry and the given files. */
function repo(root, name, files) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, ".git"), "gitdir: fixture\n");
  for (const rel of files) {
    const abs = join(root, name, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "fixture\n");
  }
}

beforeAll(() => {
  // Each layout gets its own temp root, so one fixture can never resolve
  // through another and hide a real miss.

  // Layout 1: every checkout a direct child of the workspace.
  flat = newScratch("flat");
  repo(flat, "charts", [PLANS_REL]);
  repo(flat, "sdk", [SDK_REL]);
  repo(flat, "dashboard", ["package.json"]);

  // Layout 2: checkouts under grouping directories, this workstation's shape.
  grouped = newScratch("grouped");
  repo(join(grouped, "closed/platform"), "charts", [PLANS_REL]);
  repo(join(grouped, "open"), "sdk", [SDK_REL]);
  mainCheckout = join(grouped, "closed/platform/dashboard");
  repo(join(grouped, "closed/platform"), "dashboard", ["package.json"]);
  nestedWorktree = join(mainCheckout, ".worktrees/feature-a");
  mkdirSync(join(nestedWorktree, "scripts"), { recursive: true });
  writeFileSync(join(nestedWorktree, ".git"), "gitdir: fixture\n");
  workspaceWorktree = join(grouped, ".worktrees/feature-b");
  mkdirSync(join(workspaceWorktree, "scripts"), { recursive: true });
  writeFileSync(join(workspaceWorktree, ".git"), "gitdir: fixture\n");

  const lonely = newScratch("orphan");
  orphanCheckout = join(lonely, "somewhere-else/dashboard");
  mkdirSync(join(orphanCheckout, "scripts"), { recursive: true });

  // A directory that carries the repository name but holds nothing. The
  // resolver must walk past it to the real checkout.
  decoyWorkspace = newScratch("decoy");
  mkdirSync(join(decoyWorkspace, "charts/helm"), { recursive: true });
  repo(join(decoyWorkspace, "real"), "charts", [PLANS_REL]);
  repo(decoyWorkspace, "dashboard", ["package.json"]);
});

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

describe("ancestorsOf", () => {
  it("walks to the filesystem root and terminates", () => {
    expect(ancestorsOf("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  });
});

describe("resolveRepoPath", () => {
  it("resolves a checkout that is a sibling of this one", () => {
    const got = resolveRepoPath("charts", PLANS_REL, {
      from: join(flat, "dashboard"),
    });
    expect(got?.path).toBe(join(flat, "charts", PLANS_REL));
    expect(got?.repoRoot).toBe(join(flat, "charts"));
    expect(got?.via).toBe("search");
  });

  it("resolves a checkout one grouping level away", () => {
    const got = resolveRepoPath("sdk", SDK_REL, { from: mainCheckout });
    expect(got?.path).toBe(join(grouped, "open/sdk", SDK_REL));
  });

  it("resolves from a worktree nested inside the checkout", () => {
    expect(resolveRepoPath("charts", PLANS_REL, { from: nestedWorktree })?.path).toBe(
      join(grouped, "closed/platform/charts", PLANS_REL),
    );
  });

  it("resolves from a worktree at the workspace root", () => {
    expect(
      resolveRepoPath("sdk", SDK_REL, { from: workspaceWorktree })?.path,
    ).toBe(join(grouped, "open/sdk", SDK_REL));
  });

  it("resolves from an arbitrarily deep directory, no depth assumption", () => {
    const deep = join(grouped, "a/b/c/d/e/f");
    mkdirSync(deep, { recursive: true });
    expect(resolveRepoPath("sdk", SDK_REL, { from: deep })?.path).toBe(
      join(grouped, "open/sdk", SDK_REL),
    );
  });

  // The predicate is "this directory holds the requested path", not "this
  // directory has the right name", so a same-named empty directory is skipped.
  it("walks past a directory that carries the name but not the file", () => {
    expect(
      resolveRepoPath("charts", PLANS_REL, {
        from: join(decoyWorkspace, "dashboard"),
      })?.path,
    ).toBe(join(decoyWorkspace, "real/charts", PLANS_REL));
  });

  // The descent must not enter another repository's tree, or a vendored copy
  // inside one checkout would shadow the real sibling.
  it("does not descend into a checkout while searching", () => {
    const buried = newScratch("buried");
    repo(buried, "dashboard", ["package.json"]);
    repo(join(buried, "dashboard/third_party"), ABSENT_REPO, [PLANS_REL]);
    expect(
      resolveRepoPath(ABSENT_REPO, PLANS_REL, { from: join(buried, "dashboard") }),
    ).toBeNull();
  });

  it("returns null when no such checkout is reachable", () => {
    expect(resolveRepoPath(ABSENT_REPO, PLANS_REL, { from: orphanCheckout })).toBeNull();
  });

  it("honours GIBSON_WORKSPACE_ROOT for a child checkout", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = flat;
    try {
      const got = resolveRepoPath("charts", PLANS_REL, { from: orphanCheckout });
      expect(got?.path).toBe(join(flat, "charts", PLANS_REL));
      expect(got?.via).toBe("env");
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });

  it("honours GIBSON_WORKSPACE_ROOT for a grandchild checkout", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = grouped;
    try {
      expect(
        resolveRepoPath("sdk", SDK_REL, { from: orphanCheckout })?.path,
      ).toBe(join(grouped, "open/sdk", SDK_REL));
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });

  // An explicit override that does not hold must not silently fall back to the
  // upward walk, or a typo would "work" and hide the misconfiguration.
  it("does not fall back to the search when GIBSON_WORKSPACE_ROOT is wrong", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = join(grouped, "nope");
    try {
      expect(resolveRepoPath("charts", PLANS_REL, { from: mainCheckout })).toBeNull();
      expect(resolveRepoPath(ABSENT_REPO, PLANS_REL, { from: mainCheckout })).toBeNull();
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });

  it("rejects a relative GIBSON_WORKSPACE_ROOT", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = "../checkouts";
    try {
      expect(() =>
        resolveRepoPath("charts", PLANS_REL, { from: mainCheckout }),
      ).toThrow(/must be an absolute path/);
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });
});

describe("requireRepoPath", () => {
  it("returns the path when found", () => {
    expect(requireRepoPath("charts", PLANS_REL, { from: workspaceWorktree })).toBe(
      join(grouped, "closed/platform/charts", PLANS_REL),
    );
  });

  it("throws a diagnostic naming the repository, the path and the override", () => {
    let message = "";
    try {
      requireRepoPath(ABSENT_REPO, PLANS_REL, { from: orphanCheckout });
    } catch (e) {
      message = e.message;
    }
    expect(message).toContain(PLANS_REL);
    expect(message).toContain(`zeroroot-ai/${ABSENT_REPO}`);
    expect(message).toContain(orphanCheckout);
    expect(message).toContain(WORKSPACE_ROOT_ENV);
  });
});
