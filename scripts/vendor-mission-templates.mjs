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
 * Usage: node scripts/vendor-mission-templates.mjs
 *        pnpm vendor:mission-templates
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const TEMPLATE_IDS = ["recon", "webapp-scan", "secrets-audit", "compliance-check"];
const OUT_DIR = "src/data/templates";

const adkDir = resolve(process.cwd(), "../../../opensource/adk");
if (!existsSync(adkDir)) {
  console.error(`[vendor-templates] ADK sibling not found at ${adkDir}. Run from the polyrepo workspace root or pass ADK_DIR env.`);
  process.exit(0); // soft exit — CI doesn't have the sibling
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
console.log(`[vendor-templates] done — ${vendored}/${TEMPLATE_IDS.length} templates vendored`);
