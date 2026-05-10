/**
 * /dashboard/missions/templates/[name] — detail page for a single
 * mission template. Renders the template's MDX description, the
 * parsed JSON preview, and a "Use this template" button that
 * seeds the create flow with the template content.
 *
 * Spec: mission-dashboard-rewrite Requirement 6 ACs 2, 3.
 */

import { notFound } from "next/navigation";
import Link from "next/link";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import {
  knownTemplateIds,
  loadTemplate,
} from "../_lib/templates";

interface PageProps {
  params: Promise<{ name: string }>;
}

// Statically generate one route per known template at build time.
export async function generateStaticParams() {
  return knownTemplateIds().map((name) => ({ name }));
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { name } = await params;
  if (!knownTemplateIds().includes(name as never)) {
    notFound();
  }
  const tpl = loadTemplate(name);

  return (
    <div className="px-6 py-6">
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/dashboard/missions/templates">&larr; Templates</Link>
      </nav>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{tpl.meta.title}</h1>
          <p className="text-muted-foreground">{tpl.meta.description}</p>
        </div>
        <Link
          href={`/dashboard/missions/create?template=${encodeURIComponent(tpl.meta.id)}`}
        >
          <Button>Use this template</Button>
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <article className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {tpl.mdxBody}
          </ReactMarkdown>
        </article>
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Mission JSON
            </h2>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              <code>{tpl.missionJson}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
