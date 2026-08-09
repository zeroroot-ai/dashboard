/**
 * Tests for the polyrepo sibling resolver.
 *
 * The cases that matter are the layouts the old depth-counting resolver got
 * wrong. Each builds a real directory tree under a temp dir, so the assertions
 * are about actual filesystem behaviour, not a mocked path string.
 *
 * dashboard#1015.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ancestorsOf,
  findWorkspaceRoot,
  requireWorkspacePath,
  resolveWorkspacePath,
  WORKSPACE_ROOT_ENV,
} from "./workspace-root.mjs";

const PLANS_REL = "enterprise/deploy/helm/gibson-operators/files/plans.yaml";

/** A throwaway polyrepo workspace with the dashboard and a deploy sibling. */
let workspace;
/** The main dashboard checkout inside it. */
let mainCheckout;
/** A worktree nested inside the dashboard checkout, the layout prebuild wanted. */
let nestedWorktree;
/** A worktree at the workspace root, the layout that used to walk to /home. */
let workspaceWorktree;
/** A checkout with no workspace above it at all. */
let orphanCheckout;

beforeAll(() => {
  const scratch = mkdtempSync(join(tmpdir(), "workspace-root-test-"));
  workspace = join(scratch, "zero-day.ai");

  mkdirSync(join(workspace, "enterprise/deploy/helm/gibson-operators/files"), {
    recursive: true,
  });
  writeFileSync(join(workspace, PLANS_REL), "version: v1\n");
  mkdirSync(join(workspace, "opensource/sdk/api/proto"), { recursive: true });

  mainCheckout = join(workspace, "enterprise/platform/dashboard");
  mkdirSync(join(mainCheckout, "scripts"), { recursive: true });

  nestedWorktree = join(mainCheckout, ".worktrees/feature-a");
  mkdirSync(join(nestedWorktree, "scripts"), { recursive: true });

  workspaceWorktree = join(workspace, ".worktrees/feature-b");
  mkdirSync(join(workspaceWorktree, "scripts"), { recursive: true });

  orphanCheckout = join(scratch, "somewhere-else/dashboard");
  mkdirSync(join(orphanCheckout, "scripts"), { recursive: true });

  globalThis.__wsScratch = scratch;
});

afterAll(() => {
  rmSync(globalThis.__wsScratch, { recursive: true, force: true });
});

describe("ancestorsOf", () => {
  it("walks to the filesystem root and terminates", () => {
    const chain = ancestorsOf("/a/b/c");
    expect(chain[0]).toBe("/a/b/c");
    expect(chain.at(-1)).toBe("/");
    expect(chain).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves from the main checkout", () => {
    const got = resolveWorkspacePath(PLANS_REL, { from: mainCheckout });
    expect(got?.path).toBe(join(workspace, PLANS_REL));
    expect(got?.workspaceRoot).toBe(workspace);
    expect(got?.via).toBe("search");
  });

  // The layout the old depth counter handled.
  it("resolves from a worktree nested inside the dashboard checkout", () => {
    const got = resolveWorkspacePath(PLANS_REL, { from: nestedWorktree });
    expect(got?.path).toBe(join(workspace, PLANS_REL));
  });

  // The layout the old depth counter got wrong: it produced /home/enterprise/...
  it("resolves from a worktree at the workspace root", () => {
    const got = resolveWorkspacePath(PLANS_REL, { from: workspaceWorktree });
    expect(got?.path).toBe(join(workspace, PLANS_REL));
    expect(got?.workspaceRoot).toBe(workspace);
  });

  it("resolves from an arbitrarily deep worktree, no depth assumption", () => {
    const deep = join(workspace, "a/b/c/d/e/f");
    mkdirSync(deep, { recursive: true });
    expect(resolveWorkspacePath(PLANS_REL, { from: deep })?.path).toBe(
      join(workspace, PLANS_REL),
    );
  });

  it("returns null when there is no workspace above the checkout", () => {
    expect(resolveWorkspacePath(PLANS_REL, { from: orphanCheckout })).toBeNull();
  });

  it("honours GIBSON_WORKSPACE_ROOT", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = workspace;
    try {
      const got = resolveWorkspacePath(PLANS_REL, { from: orphanCheckout });
      expect(got?.path).toBe(join(workspace, PLANS_REL));
      expect(got?.via).toBe("env");
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });

  // An explicit override that does not hold must not silently fall back to the
  // upward walk, or a typo would "work" and hide the misconfiguration.
  it("does not fall back to the search when GIBSON_WORKSPACE_ROOT is wrong", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = join(globalThis.__wsScratch, "nope");
    try {
      expect(
        resolveWorkspacePath(PLANS_REL, { from: mainCheckout }),
      ).toBeNull();
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });

  it("rejects a relative GIBSON_WORKSPACE_ROOT", () => {
    const prev = process.env[WORKSPACE_ROOT_ENV];
    process.env[WORKSPACE_ROOT_ENV] = "../zero-day.ai";
    try {
      expect(() =>
        resolveWorkspacePath(PLANS_REL, { from: mainCheckout }),
      ).toThrow(/must be an absolute path/);
    } finally {
      if (prev === undefined) delete process.env[WORKSPACE_ROOT_ENV];
      else process.env[WORKSPACE_ROOT_ENV] = prev;
    }
  });
});

describe("requireWorkspacePath", () => {
  it("returns the path when found", () => {
    expect(requireWorkspacePath(PLANS_REL, { from: workspaceWorktree })).toBe(
      join(workspace, PLANS_REL),
    );
  });

  it("throws a diagnostic listing every directory tried", () => {
    let message = "";
    try {
      requireWorkspacePath(PLANS_REL, { from: orphanCheckout });
    } catch (e) {
      message = e.message;
    }
    expect(message).toContain(`cannot locate ${PLANS_REL}`);
    expect(message).toContain(orphanCheckout);
    expect(message).toContain(WORKSPACE_ROOT_ENV);
  });
});

describe("findWorkspaceRoot", () => {
  it("finds the root from every layout", () => {
    for (const from of [mainCheckout, nestedWorktree, workspaceWorktree]) {
      expect(findWorkspaceRoot({ from })).toBe(workspace);
    }
  });

  it("returns null when there is no workspace above", () => {
    expect(findWorkspaceRoot({ from: orphanCheckout })).toBeNull();
  });
});
