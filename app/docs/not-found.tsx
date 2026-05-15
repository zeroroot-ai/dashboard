import Link from "next/link";

/**
 * Docs-scoped 404.
 *
 * Rendered when `DocsRoutePage` calls `notFound()` for an unresolved slug.
 * Next.js composes this inside `app/docs/layout.tsx`, so the shared
 * `SiteHeader` and the Fumadocs sidebar remain visible — the visitor can
 * keep browsing without bouncing.
 */
export default function DocsNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16 font-mono">
      <h1 className="text-2xl font-bold text-highlight">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        That docs page does not exist (yet). It may have moved, or been
        renamed — open the sidebar and pick another topic, or head back to
        the docs home.
      </p>
      <Link
        href="/docs"
        className="w-fit text-sm text-highlight underline underline-offset-4 hover:text-highlight"
      >
        /docs
      </Link>
    </div>
  );
}
