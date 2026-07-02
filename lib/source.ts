/**
 * Typed docs source loader.
 *
 * Wraps Fumadocs' `loader()` with our `/docs` base URL and re-exports
 * narrow helpers so consumers don't need to import from `fumadocs-core`
 * directly. This is the single entry point the docs route files use
 * to read the compiled MDX tree.
 *
 * The `docs` collection is produced by `fumadocs-mdx` at build time
 * from `source.config.ts` and emitted into the `.source/` directory
 * (gitignored).
 */
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

/**
 * The main source object. Use `source.getPage(slug)` / `source.getPages()` /
 * `source.pageTree` from route components.
 */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/** Resolve a slug tuple (from `params.slug`) to a page, or undefined. */
export const getPage = (slug: string[] | undefined) =>
  source.getPage(slug ?? []);

/** All pages in the docs tree (used by `generateStaticParams`). */
export const getPages = () => source.getPages();

/** Sidebar page tree (consumed by Fumadocs `DocsLayout`). */
export const pageTree = source.pageTree;
