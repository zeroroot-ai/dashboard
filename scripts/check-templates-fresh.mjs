#!/usr/bin/env node
/**
 * Drift gate for mission template CUE files.
 *
 * ## What it guards
 *
 * `src/data/templates/<name>.cue` is a vendored copy of
 * `opensource/adk/templates/<name>/template.cue`. The ADK copy is canonical:
 * it is the one the `gibson` CLI ships and validates. A dashboard copy that
 * has drifted seeds the mission editor with CUE the CLI would reject, so the
 * two must stay byte-identical.
 *
 * ## Modes
 *
 * STRUCTURAL (always runs, nothing can bypass it):
 *   Every committed `.cue` must exist and be non-empty. A gate that passes on
 *   a deleted or emptied artifact is not a gate, so this half runs even when
 *   there is no ADK checkout to diff against (the dashboard-only Docker
 *   build).
 *
 * FULL (adds a byte-diff when the ADK sibling is on disk):
 *   Byte-diffs each committed file against the ADK source and fails on any
 *   difference, naming the command that repairs it.
 *
 * ## Why `.mdx` is vendored but not gated
 *
 * `vendor-mission-templates.mjs` copies the `.mdx` alongside the `.cue`, but
 * this gate deliberately does not diff it. The `.mdx` is customer-rendered
 * prose on the templates gallery, and the dashboard forbids em-dashes in
 * customer-rendered prose (`check-no-emdash.mjs`, dashboard#752/#753) while
 * the ADK copies do not. `webapp-scan.mdx` already diverges for exactly that
 * reason. Gating the prose byte-for-byte would either re-import em-dashes
 * into a surface the repo is actively sweeping, or wedge the two repos
 * against each other on punctuation. The `.cue` is the executable artifact
 * and is what correctness depends on, so that is what is gated.
 *
 * ## Paths
 *
 * The ADK sibling is found at `../../../opensource/adk` relative to the
 * dashboard root, or at `$ADK_DIR` when set. `ADK_DIR` matters for git
 * worktrees, where the relative walk lands outside the workspace.
 *
 * Usage:
 *   node scripts/check-templates-fresh.mjs
 *   node scripts/check-templates-fresh.mjs --selftest
 *
 * Exit codes: 0 clean, 1 drift/missing/empty (or selftest failure).
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-templates";
const TEMPLATE_IDS = ["recon", "webapp-scan", "secrets-audit", "compliance-check", "scan-fix-verify"];
const OUT_DIR = "src/data/templates";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");

/**
 * Resolve the ADK sibling checkout. `$ADK_DIR` wins so the gate works from a
 * git worktree, where the relative walk leaves the workspace.
 */
export function resolveAdkDir(env = process.env, root = DASHBOARD_ROOT) {
  if (env.ADK_DIR) return resolve(env.ADK_DIR);
  return resolve(root, "../../../opensource/adk");
}

/**
 * The whole gate as a pure-ish function so the self-test can point it at
 * throwaway fixtures. Returns the list of failure messages (empty == pass).
 */
export function checkTemplates({ outDir, adkDir, templateIds = TEMPLATE_IDS }) {
  const failures = [];
  const hasAdk = Boolean(adkDir) && existsSync(adkDir);

  for (const id of templateIds) {
    const committedPath = join(outDir, `${id}.cue`);

    // STRUCTURAL — runs in every mode.
    if (!existsSync(committedPath)) {
      failures.push(`MISSING: ${committedPath}`);
      continue;
    }
    const committed = readFileSync(committedPath, "utf-8");
    if (!committed.trim()) {
      failures.push(`EMPTY: ${committedPath}`);
      continue;
    }

    if (!hasAdk) continue;

    // FULL — byte-diff against the canonical ADK source.
    const srcPath = join(adkDir, "templates", id, "template.cue");
    if (!existsSync(srcPath)) {
      failures.push(
        `ADK SOURCE MISSING: ${srcPath} (the template was renamed or removed upstream)`,
      );
      continue;
    }
    if (readFileSync(srcPath, "utf-8") !== committed) {
      failures.push(
        `STALE: ${committedPath} differs from the ADK source.\n` +
          `  Fix: node scripts/vendor-mission-templates.mjs && git add ${committedPath}`,
      );
    }
  }

  return failures;
}

function main() {
  const adkDir = resolveAdkDir();
  const hasAdk = existsSync(adkDir);
  const failures = checkTemplates({ outDir: join(DASHBOARD_ROOT, OUT_DIR), adkDir });

  for (const failure of failures) console.error(`[${SCRIPT_NAME}] ${failure}`);

  if (failures.length > 0) {
    console.error(
      `[${SCRIPT_NAME}] FAIL, ${failures.length} of ${TEMPLATE_IDS.length} template(s) bad.`,
    );
    process.exit(1);
  }

  console.log(
    hasAdk
      ? `[${SCRIPT_NAME}] all ${TEMPLATE_IDS.length} templates byte-match the ADK source.`
      : `[${SCRIPT_NAME}] all ${TEMPLATE_IDS.length} templates present ` +
          `(no ADK sibling at ${adkDir} to diff against).`,
  );
}

/* --------------------------------- selftest -------------------------------- */

/**
 * Build a throwaway ADK + dashboard pair, then assert the gate REJECTS every
 * defect it claims to catch and ACCEPTS a compliant tree. A gate that always
 * fails is caught by the compliant cases.
 */
function selftest() {
  const ids = ["alpha", "beta"];
  const body = (id) => `// ${id} template.\nmission: {name: "${id}"}\n`;
  const tmp = mkdtempSync(join(tmpdir(), "check-templates-selftest-"));
  let failed = 0;

  const build = ({ omit, empty, drift, withAdk = true } = {}) => {
    const root = mkdtempSync(join(tmp, "case-"));
    const outDir = join(root, "out");
    const adkDir = join(root, "adk");
    mkdirSync(outDir, { recursive: true });
    for (const id of ids) {
      if (withAdk) {
        mkdirSync(join(adkDir, "templates", id), { recursive: true });
        writeFileSync(join(adkDir, "templates", id, "template.cue"), body(id));
      }
      if (omit === id) continue;
      let text = body(id);
      if (empty === id) text = "   \n";
      if (drift === id) text = `${body(id)}// local edit\n`;
      writeFileSync(join(outDir, `${id}.cue`), text);
    }
    return { outDir, adkDir: withAdk ? adkDir : join(root, "absent") };
  };

  const expect = (label, paths, shouldPass, needle) => {
    const failures = checkTemplates({ ...paths, templateIds: ids });
    const passed = failures.length === 0;
    const joined = failures.join(" | ");
    const ok = passed === shouldPass && (shouldPass || !needle || joined.includes(needle));
    if (!ok) {
      failed += 1;
      console.error(
        `[${SCRIPT_NAME}] SELFTEST FAIL: ${label} — expected ` +
          `${shouldPass ? "PASS" : `FAIL containing "${needle}"`}, got ` +
          `${passed ? "PASS" : joined}`,
      );
    } else {
      console.log(`[${SCRIPT_NAME}] selftest ok: ${label}`);
    }
  };

  // Accepts a compliant tree, in both modes.
  expect("compliant tree with ADK sibling", build(), true);
  expect("compliant tree, no ADK sibling (structural mode)", build({ withAdk: false }), true);

  // Rejects each defect it exists to catch.
  expect("committed file drifted from ADK", build({ drift: "beta" }), false, "STALE");
  expect("committed file missing", build({ omit: "alpha" }), false, "MISSING");
  expect("committed file empty", build({ empty: "alpha" }), false, "EMPTY");
  expect("ADK source removed upstream", stripAdkSource(build(), "beta"), false, "ADK SOURCE MISSING");

  // Vacuity: the structural half must still bite with no sibling to diff.
  expect(
    "missing file with no ADK sibling",
    build({ omit: "alpha", withAdk: false }),
    false,
    "MISSING",
  );
  expect(
    "empty file with no ADK sibling",
    build({ empty: "beta", withAdk: false }),
    false,
    "EMPTY",
  );

  rmSync(tmp, { recursive: true, force: true });

  if (failed > 0) {
    console.error(`[${SCRIPT_NAME}] SELFTEST FAILED (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`[${SCRIPT_NAME}] selftest OK, the gate rejects every defect it claims to catch.`);
}

function stripAdkSource(paths, id) {
  rmSync(join(paths.adkDir, "templates", id), { recursive: true, force: true });
  return paths;
}

if (process.argv.includes("--selftest")) selftest();
else main();
