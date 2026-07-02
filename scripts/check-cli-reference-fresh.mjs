#!/usr/bin/env node
/**
 * Build guard: verify content/docs/cli-reference.mdx documents exactly the
 * set of top-level `gibson` commands the ADK registers on its root command
 * (dashboard#760).
 *
 * Two modes depending on environment
 * -----------------------------------
 *
 * FULL (ADK sibling present at REPO_ROOT/opensource/adk/):
 *   Parses the ADK's root command for the commands it adds, resolves each
 *   constructor to its cobra `Use:` name, and diffs that set against the
 *   commands documented in cli-reference.mdx. Fails when the ADK gains or
 *   renames a top-level command the reference does not document, or when the
 *   reference documents a command the ADK no longer registers.
 *
 * STRUCTURAL (ADK sibling absent, dashboard-only CI):
 *   Cannot read the command tree, so instead validates that
 *   cli-reference.mdx exists, has frontmatter, and documents a non-empty set
 *   of `gibson <command>` headings.
 *
 * There is no --skip / --permissive flag. Drift fails the build, period.
 *
 * Usage
 *   node scripts/check-cli-reference-fresh.mjs            # scan
 *   node scripts/check-cli-reference-fresh.mjs --selftest # verify the logic
 *
 * Resolution (full mode)
 *   Document the new command in content/docs/cli-reference.mdx (a `## ` or
 *   `### ` heading containing `gibson <command>`), or remove the stale one.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-cli-reference-fresh.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");

const isWorktree = DASHBOARD_ROOT.includes("/.worktrees/");
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.worktrees\/[^/]+$/, "")
  : DASHBOARD_ROOT;
const REPO_ROOT = resolve(MAIN_DASHBOARD_ROOT, "..", "..", "..");

const CLI_REF = resolve(DASHBOARD_ROOT, "content/docs/cli-reference.mdx");
const ADK_CMD_ROOT = resolve(REPO_ROOT, "opensource/adk/cli/cmd/gibson/cmd");
const ROOT_GO = join(ADK_CMD_ROOT, "root", "root.go");

// --- pure helpers (exported for selftest / reuse) ---

/** Top-level `gibson <command>` names documented in H2/H3 headings. */
export function documentedCommands(mdx) {
  const set = new Set();
  for (const line of mdx.split("\n")) {
    if (!/^#{2,3}\s/.test(line)) continue;
    for (const m of line.matchAll(/gibson\s+([a-z][a-z0-9-]*)/g)) set.add(m[1]);
  }
  return set;
}

/**
 * Resolve the set of top-level command names the ADK root registers.
 * `rootSrc` is root.go; `readPkg(dir)` returns the concatenated non-test Go
 * source of the cmd/<dir> package. Injectable so the selftest needs no FS.
 */
export function adkCommands(rootSrc, readPkg) {
  const aliasToDir = {};
  for (const m of rootSrc.matchAll(/(?:(\w+)\s+)?"[^"]*\/cmd\/gibson\/cmd\/([a-z]+)"/g)) {
    aliasToDir[m[1] || m[2]] = m[2];
  }
  const out = new Set();
  for (const m of rootSrc.matchAll(/AddCommand\(\s*(\w+)\.(\w+)\(/g)) {
    const dir = aliasToDir[m[1]];
    if (!dir) continue;
    const src = readPkg(dir);
    const fnIdx = src.indexOf(`func ${m[2]}(`);
    if (fnIdx === -1) continue;
    const use = src.slice(fnIdx).match(/Use:\s*"([a-z][a-z0-9-]*)/);
    if (use) out.add(use[1]);
  }
  return out;
}

/** { undocumented, stale } between the ADK set and the documented set. */
export function diffCommands(adk, documented) {
  return {
    undocumented: [...adk].filter((c) => !documented.has(c)).sort(),
    stale: [...documented].filter((c) => !adk.has(c)).sort(),
  };
}

function fail(msg) {
  process.stderr.write(`\n[${SCRIPT_NAME}] FAIL, ${msg}\n`);
  process.exit(1);
}

function selftest() {
  const rootSrc = `
    import (
      "github.com/x/cmd/gibson/cmd/agent"
      wscmd "github.com/x/cmd/gibson/cmd/workspace"
      "github.com/x/cmd/gibson/cmd/auth"
    )
    root.AddCommand(wscmd.Command())
    root.AddCommand(auth.LoginCommand())
    root.AddCommand(agent.Command())
  `;
  const pkgs = {
    workspace: `func Command() *cobra.Command { return &cobra.Command{ Use: "init", } }`,
    auth: `func LoginCommand() *cobra.Command { return &cobra.Command{ Use: "login", } }`,
    agent: `func Command() *cobra.Command { return &cobra.Command{ Use: "agent", } }`,
  };
  const read = (d) => pkgs[d] ?? "";
  let failed = 0;
  const check = (name, cond) => { if (!cond) { console.error(`  selftest [${name}] FAILED`); failed++; } };

  const doc = documentedCommands("## `gibson init`\n### `gibson login` / `gibson logout`\nprose gibson agent here\n");
  check("documented parses headings", doc.has("init") && doc.has("login") && doc.has("logout"));
  check("documented ignores body prose", !doc.has("agent"));

  const adk = adkCommands(rootSrc, read);
  check("adk resolves bare + aliased imports", adk.has("init") && adk.has("login") && adk.has("agent"));

  const inSync = diffCommands(new Set(["init", "login"]), new Set(["init", "login"]));
  check("in-sync -> empty diff", inSync.undocumented.length === 0 && inSync.stale.length === 0);

  const drift = diffCommands(new Set(["init", "login", "connector"]), new Set(["init", "login", "removed"]));
  check("undocumented detected", drift.undocumented.join() === "connector");
  check("stale detected", drift.stale.join() === "removed");

  if (failed) { console.error(`check-cli-reference-fresh selftest: ${failed} case(s) failed`); process.exit(1); }
  console.log("✓ check-cli-reference-fresh selftest: all cases passed");
}

function main() {
  if (process.argv.includes("--selftest")) return selftest();

  let refRaw;
  try {
    refRaw = readFileSync(CLI_REF, "utf8");
  } catch (err) {
    fail(`cannot read ${CLI_REF}: ${err.message}`);
  }
  if (!refRaw.startsWith("---")) fail("cli-reference.mdx is missing its frontmatter block");

  const documented = documentedCommands(refRaw);
  if (documented.size === 0) fail("cli-reference.mdx documents no `gibson <command>` headings");

  if (!existsSync(ROOT_GO)) {
    process.stdout.write(
      `[${SCRIPT_NAME}] STRUCTURAL ok, ${documented.size} commands documented ` +
        `(ADK sibling absent; full diff skipped)\n`,
    );
    return;
  }

  const rootSrc = readFileSync(ROOT_GO, "utf8");
  const readPkg = (dir) => {
    const abs = join(ADK_CMD_ROOT, dir);
    let out = "";
    for (const f of readdirSync(abs)) {
      if (f.endsWith(".go") && !f.endsWith("_test.go")) out += readFileSync(join(abs, f), "utf8") + "\n";
    }
    return out;
  };

  const adk = adkCommands(rootSrc, readPkg);
  if (adk.size === 0) fail(`resolved no command names from ${ROOT_GO} (parser drift?)`);

  const { undocumented, stale } = diffCommands(adk, documented);
  if (undocumented.length || stale.length) {
    let msg = "cli-reference.mdx is out of sync with the ADK command tree.\n";
    if (undocumented.length) {
      msg += `\n  ADK registers but the reference does not document: ${undocumented.join(", ")}` +
        `\n    -> add a heading for each in content/docs/cli-reference.mdx`;
    }
    if (stale.length) {
      msg += `\n  Reference documents but the ADK no longer registers: ${stale.join(", ")}` +
        `\n    -> remove the stale section(s)`;
    }
    fail(msg);
  }

  process.stdout.write(
    `[${SCRIPT_NAME}] FULL ok, ${adk.size} top-level commands documented and in sync\n`,
  );
}

main();
