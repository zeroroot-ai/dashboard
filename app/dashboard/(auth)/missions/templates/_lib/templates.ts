/**
 * Server-side helpers for the mission templates gallery. Reads
 * the vendored template.cue + template.mdx pairs from
 * src/data/templates/ and exposes a typed catalog.
 *
 * Vendored from opensource/adk/templates/<name>/{template.cue,template.mdx}
 * by scripts/vendor-mission-templates.mjs (sibling-checkout dev workflow).
 *
 * Spec: mission-dashboard-rewrite Requirement 6 ACs 1, 2, 3.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface TemplateCatalogEntry {
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

const KNOWN_TEMPLATE_IDS = [
  "recon",
  "webapp-scan",
  "secrets-audit",
  "compliance-check",
] as const;

type TemplateId = (typeof KNOWN_TEMPLATE_IDS)[number];

export function listTemplates(): TemplateCatalogEntry[] {
  return KNOWN_TEMPLATE_IDS.map(loadTemplateMeta);
}

function loadTemplateMeta(id: string): TemplateCatalogEntry {
  const mdxPath = join(process.cwd(), TEMPLATES_DIR, `${id}.mdx`);
  const raw = readFileSync(mdxPath, "utf-8");
  return parseFrontmatter(id, raw);
}

interface LoadedTemplate {
  meta: TemplateCatalogEntry;
  /** Body of the MDX file with frontmatter stripped. */
  mdxBody: string;
  /** Raw CUE source (for the "Use this template" editor seeding and preview panel). */
  cueSource: string;
}

export function loadTemplate(id: string): LoadedTemplate {
  const meta = loadTemplateMeta(id);
  const mdxPath = join(process.cwd(), TEMPLATES_DIR, `${id}.mdx`);
  const cuePath = join(process.cwd(), TEMPLATES_DIR, `${id}.cue`);
  const rawMdx = readFileSync(mdxPath, "utf-8");
  const cueSource = readFileSync(cuePath, "utf-8");
  const { body } = splitFrontmatter(rawMdx);
  return {
    meta,
    mdxBody: body,
    cueSource,
  };
}

function parseFrontmatter(id: string, raw: string): TemplateCatalogEntry {
  const { frontmatter, body } = splitFrontmatter(raw);
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

export function knownTemplateIds(): TemplateId[] {
  return [...KNOWN_TEMPLATE_IDS];
}

if (process.env.NODE_ENV !== "production") {
  try {
    const files = readdirSync(join(process.cwd(), TEMPLATES_DIR));
    const stems = new Set<string>();
    for (const f of files) {
      const m = f.match(/^(.+)\.(cue|mdx)$/);
      if (m) stems.add(m[1]);
    }
    for (const s of stems) {
      if (!(KNOWN_TEMPLATE_IDS as readonly string[]).includes(s)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[templates] dir contains ${s}.* but it's missing from KNOWN_TEMPLATE_IDS, add to src/app/dashboard/(auth)/missions/templates/_lib/templates.ts`,
        );
      }
    }
  } catch {
    /* ignore, first-run before vendor */
  }
}
