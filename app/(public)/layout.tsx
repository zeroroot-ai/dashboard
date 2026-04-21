import { SiteHeader } from "@/components/gibson/site-header";
import type { CSSProperties } from "react";

/**
 * Public layout — landing page, pricing, login, and signup all sit under
 * this wrapper.
 *
 * Two non-obvious things going on here:
 *
 * 1. `dark` class is forced so Shadcn's CSS custom properties resolve to
 *    their dark-mode values. Without it, every Shadcn primitive (Input
 *    text, Card background, Border color) renders as light-mode on the
 *    dark `bg-[#050a07]` body — invisible text, invisible checkboxes.
 *
 * 2. The page background is `#050a07` (a near-black with green undertone
 *    for the terminal-hacker theme on the landing page), which is darker
 *    than Shadcn's stock dark mode (--background = oklch(0.141)). Shadcn's
 *    default --input / --border in dark mode (~oklch(0.37)) are calibrated
 *    against that lighter dark — on our deeper background they almost
 *    disappear. We brighten just those two tokens locally so form
 *    primitives keep enough contrast to be visible. CSS vars cascade, so
 *    every descendant Card / Input / Checkbox / Select picks this up
 *    without any per-component className.
 */
const publicSurfaceTheme: CSSProperties = {
  // Brighter than base-700 — visible border on bg-[#050a07].
  ["--input" as never]: "oklch(0.55 0.012 285.81)",
  ["--border" as never]: "oklch(0.5 0.012 285.81)",
  // Make Card surfaces a perceptible step lighter than the page so signup
  // / login cards stand off the background instead of bleeding into it.
  ["--card" as never]: "oklch(0.18 0.005 285.83)",
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="dark min-h-screen bg-[#050a07] text-foreground"
      style={publicSurfaceTheme}
    >
      <SiteHeader />
      <main>{children}</main>
    </div>
  );
}
