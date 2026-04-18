import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import { getMDXComponents } from "@/mdx-components";
import { source, getPages } from "@/lib/source";

/**
 * Dynamic docs renderer. One of these handles every `/docs/*` URL.
 *
 *   - `/docs` → resolves slug `[]` to `content/docs/index.mdx`
 *   - `/docs/getting-started` → resolves to `getting-started.mdx`
 *   - `/docs/foo/bar` → resolves to `foo/bar.mdx` or `foo/bar/index.mdx`
 *
 * Unresolved slugs fall through to `notFound()` which hands off to the
 * docs-scoped 404 at `app/docs/not-found.tsx`.
 */
export default async function DocsRoutePage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug ?? []);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={false}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

/**
 * Statically generate every doc page at build time so client-side
 * navigation stays instant and search indexes align with the route tree.
 */
export function generateStaticParams() {
  return getPages().map((page) => ({ slug: page.slugs }));
}

/**
 * Emit per-page `<title>` and `<meta description>` from frontmatter.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug ?? []);
  if (!page) return {};
  return {
    title: page.data.title,
    description: page.data.description,
  };
}
