#!/usr/bin/env node
/**
 * Vendor mission template CUE source files from the ADK sibling clone.
 *
 * Primary source: opensource/adk/templates/<name>/template.cue
 * Output:        src/data/templates/<name>.cue
 *
 * In CI without the sibling checkout, the committed .cue files are
 * used directly (check-templates-fresh.mjs validates them instead).
 *
 * The sibling is found at ../../../opensource/adk relative to the dashboard
 * root, or at $ADK_DIR when set. ADK_DIR matters for git worktrees, where the
 * relative walk lands outside the workspace.
 *
 * Only the .cue is vendored. The sibling .mdx is NOT copied: it is customer-
 * rendered prose on the templates gallery and the dashboard forbids em-dashes
 * there (check-no-emdash.mjs, dashboard#752/#753), which the ADK copies use.
 * The dashboard .mdx is a house-style copy, kept by hand.
 *
 * Usage: node scripts/vendor-mission-templates.mjs
 *        ADK_DIR=/path/to/adk node scripts/vendor-mission-templates.mjs
 *        pnpm vendor:mission-templates
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_IDS = ["recon", "webapp-scan", "secrets-audit", "compliance-check"];

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(DASHBOARD_ROOT, "src/data/templates");
const adkDir = process.env.ADK_DIR
  ? resolve(process.env.ADK_DIR)
  : resolve(DASHBOARD_ROOT, "../../../opensource/adk");
if (!existsSync(adkDir)) {
  console.error(`[vendor-templates] ADK sibling not found at ${adkDir}. Run from the polyrepo workspace, or set ADK_DIR.`);
  process.exit(0); // soft exit, CI doesn't have the sibling
}

mkdirSync(OUT_DIR, { recursive: true });
let vendored = 0;
for (const id of TEMPLATE_IDS) {
  const src = join(adkDir, "templates", id, "template.cue");
  const dst = join(OUT_DIR, `${id}.cue`);
  if (!existsSync(src)) {
    console.warn(`[vendor-templates] ${id}: source not found at ${src}, skipping`);
    continue;
  }
  copyFileSync(src, dst);
  console.log(`[vendor-templates] ${id}.cue vendored`);
  vendored++;
}
console.log(`[vendor-templates] done, ${vendored}/${TEMPLATE_IDS.length} templates vendored`);
