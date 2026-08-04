#!/usr/bin/env node
/**
 * check-docs-links.mjs
 *
 * Build-time guard enforcing internal-link integrity in committed
 * `content/docs/*.mdx`. From dashboard#99 (parent: PRD #97).
 *
 * For every `[label](./slug)` or `[label](./slug#anchor)` reference in
 * an MDX file:
 *
 *   - Verify `content/docs/<slug>.mdx` exists.
 *   - For `#anchor`, verify a heading on the target page has the
 *     matching slug (lower-case, alphanumerics + dashes).
 *
 * No allowlist, broken internal links should never be acceptable on
 * the customer-facing docs site.
 *
 * Modes:
 *
 *   (default)    Scan; fail on any broken link.
 *   --selftest   Synthesises a temp MDX with one broken slug + one
 *                broken anchor, asserts the scanner catches both,
 *                cleans up.
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "content", "docs");

// Match Markdown links pointing at absolute /docs/ slugs:
//   [label](/docs/slug)
//   [label](/docs/slug#anchor)
//   [label](/docs/folder/slug)
// Absolute paths are required because Next.js's Link component does not
// resolve relative hrefs (`./slug`) the way a plain <a> tag would -
// `<Link href="./ontology">` clicked from /docs/first-agent does NOT
// navigate to /docs/ontology. See dashboard#97 follow-up sweep.
//
// The slug is multi-segment: `content/docs/` holds folder sections
// (e.g. `coding-agent/`) whose pages render at `/docs/<folder>/<page>`.
// A single-segment pattern would silently skip every such link instead
// of validating it.
const LINK_RE = /\[[^\]]+\]\(\/docs\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)(#[a-z0-9-]+)?\)/g;

// Regression guard: relative `./slug` references inside docs MDX render
// as `<a href="./slug">` which Next.js's client-side router refuses to
// navigate. We forbid them entirely and the absolute /docs/ form above
// is the canonical pattern.
const FORBIDDEN_RELATIVE_RE = /\[[^\]]+\]\(\.\/[a-z0-9-]+(?:\/[a-z0-9-]+)*/g;

// Headings, capture top-level Markdown headings (any level) and slugify
// them the way fumadocs / GitHub renders anchors: lower-case, strip
// non-alphanumerics except dashes, collapse spaces to dashes.
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/gm;

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function* walkMdx(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walkMdx(path);
    } else if (entry.endsWith(".mdx")) {
      yield path;
    }
  }
}

// Resolve a /docs/ slug to the MDX file that renders it, or null.
// A folder section is addressed by its own slug (`/docs/coding-agent`),
// which fumadocs renders from `<folder>/index.mdx`.
function resolveTarget(slug) {
  for (const candidate of [
    join(SCAN_DIR, `${slug}.mdx`),
    join(SCAN_DIR, slug, "index.mdx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function pageAnchors(targetSlug) {
  const targetPath = resolveTarget(targetSlug);
  if (!targetPath) return null;
  const content = readFileSync(targetPath, "utf8");
  const anchors = new Set();
  for (const m of content.matchAll(HEADING_RE)) {
    anchors.add(slugify(m[1]));
  }
  return anchors;
}

function scan() {
  const broken = [];
  if (!existsSync(SCAN_DIR)) return broken;
  const anchorCache = new Map();

  for (const file of walkMdx(SCAN_DIR)) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Forbid `./slug` relative form, won't navigate via Next.js Link.
      for (const m of line.matchAll(FORBIDDEN_RELATIVE_RE)) {
        broken.push({
          file: relative(ROOT, file),
          line: i + 1,
          link: m[0] + "…)",
          reason: `relative href won't navigate via Next.js Link, use absolute "/docs/<slug>" instead`,
        });
      }

      // Validate absolute /docs/slug references.
      for (const m of line.matchAll(LINK_RE)) {
        const slug = m[1];
        const anchor = m[2] ? m[2].slice(1) : null;

        if (!resolveTarget(slug)) {
          broken.push({
            file: relative(ROOT, file),
            line: i + 1,
            link: m[0],
            reason: `target page "${slug}.mdx" does not exist`,
          });
          continue;
        }

        if (anchor) {
          if (!anchorCache.has(slug)) {
            anchorCache.set(slug, pageAnchors(slug));
          }
          const anchors = anchorCache.get(slug);
          if (anchors && !anchors.has(anchor)) {
            broken.push({
              file: relative(ROOT, file),
              line: i + 1,
              link: m[0],
              reason: `anchor "#${anchor}" not found on ${slug}.mdx`,
            });
          }
        }
      }
    }
  }
  return broken;
}

function selftest() {
  const tempBadSlug = join(SCAN_DIR, "__selftest_bad_slug__.mdx");
  const tempBadAnchor = join(SCAN_DIR, "__selftest_bad_anchor__.mdx");
  const tempRelative = join(SCAN_DIR, "__selftest_relative__.mdx");
  const tempNested = join(SCAN_DIR, "__selftest_nested__.mdx");
  writeFileSync(
    tempBadSlug,
    "See [the missing page](/docs/this-slug-does-not-exist).\n",
  );
  writeFileSync(
    tempBadAnchor,
    "See [bogus anchor](/docs/install#this-anchor-does-not-exist).\n",
  );
  writeFileSync(
    tempRelative,
    "See [relative form](./install), should be forbidden.\n",
  );
  writeFileSync(
    tempNested,
    "See [missing folder page](/docs/selftest-folder/missing-page).\n",
  );
  try {
    const broken = scan();
    const slugMiss = broken.find(
      (b) => b.file.endsWith("__selftest_bad_slug__.mdx") && /does not exist/.test(b.reason),
    );
    const anchorMiss = broken.find(
      (b) =>
        b.file.endsWith("__selftest_bad_anchor__.mdx") &&
        /anchor "#this-anchor-does-not-exist" not found/.test(b.reason),
    );
    const relForbidden = broken.find(
      (b) => b.file.endsWith("__selftest_relative__.mdx") && /won't navigate via Next.js Link/.test(b.reason),
    );
    if (!slugMiss) {
      console.error("✗ selftest FAILED: scanner did not catch missing slug");
      process.exit(1);
    }
    if (!anchorMiss) {
      console.error("✗ selftest FAILED: scanner did not catch missing anchor");
      process.exit(1);
    }
    if (!relForbidden) {
      console.error("✗ selftest FAILED: scanner did not catch relative ./slug form");
      process.exit(1);
    }
    const nestedMiss = broken.find(
      (b) => b.file.endsWith("__selftest_nested__.mdx") && /does not exist/.test(b.reason),
    );
    if (!nestedMiss) {
      console.error("✗ selftest FAILED: scanner did not catch missing folder-section page");
      process.exit(1);
    }
    console.log(
      "✓ selftest passed (scanner catches missing slug + missing anchor + forbidden relative form + missing folder-section page)",
    );
  } finally {
    if (existsSync(tempBadSlug)) unlinkSync(tempBadSlug);
    if (existsSync(tempBadAnchor)) unlinkSync(tempBadAnchor);
    if (existsSync(tempRelative)) unlinkSync(tempRelative);
    if (existsSync(tempNested)) unlinkSync(tempNested);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--selftest")) {
    selftest();
    return;
  }

  const broken = scan();
  if (broken.length === 0) {
    console.log("✓ check-docs-links: all internal /docs/* links resolve");
    return;
  }

  console.error(
    `✗ check-docs-links: ${broken.length} broken internal link(s) in committed docs.\n`,
  );
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line}  ${b.link}`);
    console.error(`    → ${b.reason}`);
  }
  process.exit(1);
}

main();
