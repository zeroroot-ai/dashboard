import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { SiteHeader } from "@/components/gibson/site-header";
import { pageTree } from "@/lib/source";

// Fumadocs' UI stylesheet (keyframes, resets, sidebar + TOC baseline).
// Our own `docs-theme.css` is imported AFTER so its variable overrides win.
import "fumadocs-ui/style.css";
import "@/components/gibson/docs/docs-theme.css";

/**
 * Docs shell.
 *
 * Composes the shared `SiteHeader` (identical to landing + pricing) above
 * Fumadocs' `DocsLayout`. The root wrapper carries `docs-root` so the
 * CSS variable overrides in `docs-theme.css` are scoped here only and
 * cannot bleed into the dashboard or marketing routes.
 *
 * `data-no-scanlines` on the wrapper is an explicit opt-out from the
 * landing's CRT scanline overlay — long-form prose legibility takes
 * precedence over the effect.
 *
 * `theme={{ enabled: false }}` prevents Fumadocs' internal next-themes
 * provider from double-wrapping the app-level one already mounted in
 * `app/layout.tsx`.
 *
 * `nav={{ enabled: false }}` suppresses Fumadocs' default top navbar —
 * we use the shared `SiteHeader` instead. A copy of the site header
 * lives here rather than duplicating its markup.
 */
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="docs-root min-h-screen bg-background text-foreground"
      data-no-scanlines
    >
      <SiteHeader />
      <RootProvider theme={{ enabled: false }}>
        <DocsLayout
          tree={pageTree}
          nav={{ enabled: false }}
          sidebar={{ defaultOpenLevel: 1 }}
        >
          {children}
        </DocsLayout>
      </RootProvider>
    </div>
  );
}
