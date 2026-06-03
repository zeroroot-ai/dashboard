/**
 * Fumadocs MDX source configuration.
 *
 * Single source of truth for "what is a docs page" and how its MDX is
 * processed. Scanned content lives under `content/docs/` at the dashboard
 * root. Frontmatter is validated at build time against the schema below —
 * missing `title` or `description` fails the build with a clear error.
 *
 * Remark-gfm is enabled for GitHub-flavored markdown (tables, strikethrough,
 * task lists). Syntax highlighting uses Fumadocs' built-in Shiki integration
 * with a dark theme that complements the Zero Root AI hacker palette.
 *
 * We ship our own Zod v3 schema rather than extending Fumadocs' internal
 * zod v4 schema so the root project stays on a single zod major. Zod 3.24+
 * implements the Standard Schema v1 spec, which fumadocs-mdx accepts.
 */
import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import remarkGfm from "remark-gfm";
import { z } from "zod";

/**
 * Page frontmatter schema.
 *
 *   - `title` — required human-readable page title (sidebar, `<title>`, H1)
 *   - `description` — required short summary (SEO description, TOC preview)
 *   - `order` — optional sibling sort order in the sidebar (lower = earlier)
 */
const pageSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().optional(),
});

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkGfm],
    rehypeCodeOptions: {
      themes: {
        light: "github-dark",
        dark: "github-dark",
      },
    },
  },
});
