/**
 * Server-side helpers for the mission templates gallery. Reads
 * the vendored template.json + template.mdx pairs from
 * src/data/templates/ and exposes a typed catalog.
 *
 * Vendored from opensource/adk/templates/<name>/{template.json,template.mdx}
 * by scripts/vendor-mission-authoring-bundle.mjs (and a sibling
 * fallback for sibling-checkout dev workflows).
 *
 * Spec: mission-dashboard-rewrite Requirement 6 ACs 1, 2, 3.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { MissionDefinition } from "@/src/gen/gibson/mission/v1/mission_definition_pb";

export interface TemplateCatalogEntry {
  /** kebab-case template id (filename stem). */
  id: string;
  /** Title from the MDX frontmatter. */
  title: string;
  /** description from the MDX frontmatter. */
  description: string;
  /** First non-frontmatter line of the MDX, used as a synopsis. */
  synopsis: string;
}

const TEMPLATES_DIR = "src/data/templates";

// Hard-coded catalog so the gallery page is deterministic and
// can fail-fast if a template goes missing. Adding a template
// means: vendor template.json + template.mdx into src/data/templates,
// then add an entry here. The CI drift gate ensures the JSON
// matches the CUE source.
const KNOWN_TEMPLATE_IDS = [
  "recon",
  "webapp-scan",
  "secrets-audit",
  "compliance-check",
] as const;

export type TemplateId = (typeof KNOWN_TEMPLATE_IDS)[number];

export function listTemplates(): TemplateCatalogEntry[] {
  return KNOWN_TEMPLATE_IDS.map(loadTemplateMeta);
}

export function loadTemplateMeta(id: string): TemplateCatalogEntry {
  const mdxPath = join(process.cwd(), TEMPLATES_DIR, `${id}.mdx`);
  const raw = readFileSync(mdxPath, "utf-8");
  return parseFrontmatter(id, raw);
}

export interface LoadedTemplate {
  meta: TemplateCatalogEntry;
  /** Body of the MDX file with frontmatter stripped. */
  mdxBody: string;
  /** Parsed mission JSON the user will fork. */
  mission: MissionDefinition;
  /** Raw JSON string (for "view source" disclosure). */
  missionJson: string;
}

export function loadTemplate(id: string): LoadedTemplate {
  const meta = loadTemplateMeta(id);
  const mdxPath = join(process.cwd(), TEMPLATES_DIR, `${id}.mdx`);
  const jsonPath = join(process.cwd(), TEMPLATES_DIR, `${id}.json`);
  const rawMdx = readFileSync(mdxPath, "utf-8");
  const rawJson = readFileSync(jsonPath, "utf-8");
  const { body } = splitFrontmatter(rawMdx);
  // We deliberately skip protojson.Unmarshal here — the gallery's
  // detail page only needs the shape for "Use this template" form
  // pre-fill, which happens client-side after the user clicks.
  // Keep the JSON as raw bytes here; the client component does
  // the protojson decode.
  const mission = JSON.parse(rawJson) as MissionDefinition;
  return {
    meta,
    mdxBody: body,
    mission,
    missionJson: rawJson,
  };
}

function parseFrontmatter(id: string, raw: string): TemplateCatalogEntry {
  const { frontmatter, body } = splitFrontmatter(raw);
  // First non-blank, non-heading line of the body is the synopsis.
  const firstPara = body
    .split("\n\n")
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  return {
    id,
    title: frontmatter.title || id,
    description: frontmatter.description || "",
    synopsis: firstPara ?? frontmatter.description ?? "",
  };
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const [, fm, body] = m;
  const obj: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    obj[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return { frontmatter: obj, body };
}

// Surface for static-route generation in [name]/page.tsx.
export function knownTemplateIds(): TemplateId[] {
  return [...KNOWN_TEMPLATE_IDS];
}

// Defensive: warn if the templates dir on disk has more files
// than the hard-coded list. Helps catch additions made without
// updating KNOWN_TEMPLATE_IDS. Logged via console on import in dev.
if (process.env.NODE_ENV !== "production") {
  try {
    const files = readdirSync(join(process.cwd(), TEMPLATES_DIR));
    const stems = new Set<string>();
    for (const f of files) {
      const m = f.match(/^(.+)\.(json|mdx)$/);
      if (m) stems.add(m[1]);
    }
    for (const s of stems) {
      if (!(KNOWN_TEMPLATE_IDS as readonly string[]).includes(s)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[templates] dir contains ${s}.* but it's missing from KNOWN_TEMPLATE_IDS — add to src/app/dashboard/(auth)/missions/templates/_lib/templates.ts`,
        );
      }
    }
  } catch {
    /* ignore — first-run before vendor */
  }
}
