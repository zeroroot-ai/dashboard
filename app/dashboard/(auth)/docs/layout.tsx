/**
 * Docs route layout, sidebar nav for the mission-authoring docs
 * pages vendored from the SDK's mission-authoring bundle.
 *
 * Spec: mission-dashboard-rewrite Requirement 5 ACs 1, 2, 3.
 */

import Link from "next/link";
import type { ReactNode } from "react";

const docPages = [
  {
    href: "/dashboard/docs",
    title: "Overview",
  },
  {
    href: "/dashboard/docs/verbs",
    title: "Mission Verbs",
  },
  {
    href: "/dashboard/docs/nouns",
    title: "Mission Nouns",
  },
  {
    href: "/dashboard/docs/schema-reference",
    title: "Schema Reference",
  },
  {
    href: "/dashboard/docs/templates",
    title: "Templates",
  },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-8 px-6 py-6">
      <aside className="w-56 shrink-0">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Mission DSL
        </h2>
        <nav className="flex flex-col gap-1">
          {docPages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="rounded px-2 py-1 text-sm hover:bg-muted"
            >
              {p.title}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="prose prose-sm max-w-3xl dark:prose-invert">
        {children}
      </main>
    </div>
  );
}
