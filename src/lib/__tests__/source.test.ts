/**
 * Smoke test for `lib/source.ts`.
 *
 * What this verifies:
 *   - `lib/source.ts` correctly wraps Fumadocs' `loader()` with the `/docs`
 *     base URL.
 *   - `getPage(['getting-started'])` returns a page with title and
 *     description populated from real MDX frontmatter under
 *     `content/docs/`.
 *   - `pageTree` exposes page URLs that include the required starter
 *     pages from requirements §5.
 *
 * The `.source/server.ts` artifact produced by the `fumadocs-mdx` CLI
 * uses webpack/turbopack's `?collection=docs` query imports which
 * vitest does not understand. We stub the import here with a minimal
 * Fumadocs source built from the real MDX frontmatter on disk — the
 * tree shape and frontmatter are therefore genuine, only the compiled
 * MDX body (which this test does not exercise) is elided.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";

// Dashboard root (two levels up from src/lib/__tests__/).
const DASHBOARD_ROOT = resolve(__dirname, "..", "..", "..");
const CONTENT_DIR = resolve(DASHBOARD_ROOT, "content", "docs");

interface Frontmatter {
  title: string;
  description: string;
  order?: number;
}

/** Parse YAML-style frontmatter (title/description/order lines). */
function readFrontmatter(absPath: string): Frontmatter {
  const raw = readFileSync(absPath, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) throw new Error(`No frontmatter in ${absPath}`);
  const fm: Partial<Frontmatter> = {};
  for (const line of match[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim().replace(/^['"]|['"]$/g, "");
    if (key === "order") {
      fm.order = Number(value);
    } else if (key === "title" || key === "description") {
      fm[key] = value;
    }
  }
  if (!fm.title || !fm.description) {
    throw new Error(`Invalid frontmatter in ${absPath}: ${JSON.stringify(fm)}`);
  }
  return fm as Frontmatter;
}

/**
 * Build a minimal Fumadocs Source-compatible object from the real
 * MDX files on disk. Only the fields `lib/source.ts` and its consumers
 * read (title, description, slugs, url) are populated.
 */
function buildMockSource() {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".mdx"));
  const pages = files.map((filename) => {
    const stem = filename.replace(/\.mdx$/, "");
    const data = readFrontmatter(resolve(CONTENT_DIR, filename));
    return {
      _file: { path: filename },
      path: filename,
      slugs: stem === "index" ? [] : [stem],
      data,
    };
  });
  return { pages };
}

const mockCollection = buildMockSource();

// Mock the compiled `.source/server` export with a Fumadocs-compatible
// surface backed by the real MDX frontmatter from disk.
vi.mock("@/.source/server", () => {
  return {
    docs: {
      toFumadocsSource: () => ({
        files: mockCollection.pages.map((p) => ({
          type: "page" as const,
          path: p.path,
          data: p.data,
        })),
      }),
    },
  };
});

describe("lib/source", () => {
  it("getPage(['getting-started']) returns a page with non-empty title + description", async () => {
    const { getPage } = await import("@/lib/source");
    const page = getPage(["getting-started"]);
    expect(page).toBeDefined();
    expect(page?.data.title).toBeTruthy();
    expect(page?.data.title.length).toBeGreaterThan(0);
    expect(page?.data.description).toBeTruthy();
    expect(page?.data.description.length).toBeGreaterThan(0);
  });

  it("pageTree contains required starter pages under /docs/*", async () => {
    const { source } = await import("@/lib/source");
    const urls: string[] = [];
    const walk = (node: unknown): void => {
      const n = node as { url?: string; children?: unknown[] };
      if (n.url) urls.push(n.url);
      if (Array.isArray(n.children)) n.children.forEach(walk);
    };
    walk(source.pageTree);
    // At minimum the three pages the task names must be present.
    for (const slug of ["getting-started", "install", "missions"]) {
      expect(urls).toContain(`/docs/${slug}`);
    }
  });
});
