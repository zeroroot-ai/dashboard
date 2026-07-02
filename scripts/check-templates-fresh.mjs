#!/usr/bin/env node
/**
 * Drift gate for mission template CUE files.
 *
 * When the ADK sibling is present (polyrepo dev workflow):
 *   - Reads each template's canonical source from
 *     opensource/adk/templates/<name>/template.cue
 *   - Byte-diffs against the committed src/data/templates/<name>.cue
 *   - Fails if any committed file is stale; prints the diff command.
 *
 * When the ADK sibling is absent (dashboard-only CI):
 *   - Validates that all four .cue files are present and non-empty.
 *
 * Wired into pnpm prebuild so drift fails the build.
 *
 * Usage: node scripts/check-templates-fresh.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TEMPLATE_IDS = ["recon", "webapp-scan", "secrets-audit", "compliance-check"];
const OUT_DIR = "src/data/templates";

let failed = false;

const adkDir = resolve(process.cwd(), "../../../opensource/adk");
const hasAdk = existsSync(adkDir);

for (const id of TEMPLATE_IDS) {
  const committedPath = join(OUT_DIR, `${id}.cue`);

  if (!existsSync(committedPath)) {
    console.error(`[check-templates] MISSING: ${committedPath}`);
    failed = true;
    continue;
  }

  const committed = readFileSync(committedPath, "utf-8");

  if (!committed.trim()) {
    console.error(`[check-templates] EMPTY: ${committedPath}`);
    failed = true;
    continue;
  }

  if (hasAdk) {
    const srcPath = join(adkDir, "templates", id, "template.cue");
    if (!existsSync(srcPath)) {
      console.warn(`[check-templates] ADK source not found for ${id}, skipping diff`);
      continue;
    }
    const canonical = readFileSync(srcPath, "utf-8");
    if (canonical !== committed) {
      console.error(
        `[check-templates] STALE: ${committedPath} differs from ADK source.\n` +
          `  Fix: node scripts/vendor-mission-templates.mjs && git add ${committedPath}`,
      );
      failed = true;
    } else {
      console.log(`[check-templates] ok: ${id}.cue`);
    }
  } else {
    console.log(`[check-templates] present (no ADK sibling to diff): ${id}.cue`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`[check-templates] all ${TEMPLATE_IDS.length} templates ok`);
