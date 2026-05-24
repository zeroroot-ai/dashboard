/**
 * Server-side reader for the vendored mission-authoring MDX files.
 * Each file lives at src/app/dashboard/(auth)/docs/<name>.mdx and
 * has a leading YAML frontmatter block (---\n…\n---).
 *
 * The frontmatter is parsed for title + description; the rest of
 * the file is rendered by react-markdown with remark-gfm.
 *
 * Spec: mission-dashboard-rewrite Requirement 5 AC 1.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DocPage {
  title: string;
  description?: string;
  body: string;
}

export function loadDocPage(slug: string): DocPage {
  // Resolve relative to this file's directory regardless of where
  // Next places the bundled output. process.cwd() is the project
  // root in App Router server components.
  const path = join(
    process.cwd(),
    "src/app/dashboard/(auth)/docs",
    `${slug}.mdx`,
  );
  const raw = readFileSync(path, "utf-8");
  return parseFrontmatter(raw);
}

function parseFrontmatter(raw: string): DocPage {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { title: "", body: raw };
  }
  const [, fm, body] = fmMatch;
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return {
    title: meta.title ?? "",
    description: meta.description,
    body,
  };
}

export function MarkdownBody({ body }: { body: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
  );
}
