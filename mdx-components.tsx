/**
 * MDX shortcode registry.
 *
 * Per Next.js App Router's MDX convention, this file exports
 * `useMDXComponents` at the application root so MDX pages render
 * a consistent set of components (headings, links, Callout, Card,
 * code-block tabs) without needing to import them in every `.mdx`.
 *
 * Base map: Fumadocs' `defaultMdxComponents` (headings, anchors,
 * Callout, Cards, code-block primitives). Custom Gibson-specific
 * MDX shortcodes can be added under
 * `components/gibson/docs/mdx/` and merged in below.
 *
 * This file must stay a pure mapping, no client-side effects, no
 * business logic. It runs in both server and client MDX contexts.
 */
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/**
 * The component map itself. Plain object, safe to call from either a
 * Server Component (e.g. `app/docs/[[...slug]]/page.tsx`) or a client
 * MDX consumer.
 */
const mdxComponents: MDXComponents = {
  ...defaultMdxComponents,
  // Slot: add custom Gibson MDX shortcodes here once authored, e.g.
  //   ...(await import("@/components/gibson/docs/mdx")).default,
};

/**
 * Convenience accessor for server components, returns the merged map.
 * The name is not prefixed with `use` on purpose (no React-hook semantics).
 */
export function getMDXComponents(
  extra?: MDXComponents,
): MDXComponents {
  return { ...mdxComponents, ...extra };
}

/**
 * Next.js MDX convention: when a top-level `mdx-components.tsx` exports
 * `useMDXComponents`, the `.mdx` pipeline uses it automatically for any
 * route-rendered MDX content.
 */
export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...mdxComponents, ...components };
}
