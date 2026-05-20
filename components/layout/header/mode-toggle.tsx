"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Bracketed light/dark toggle — brand-guide-exact `[x] dark · [ ] light`
 * pair. Lives in the header so it's reachable from every page.
 *
 * Why a custom component instead of the existing ColorModeSelector inside
 * ThemeCustomizerPanel: the selector is buried inside a popover. The brand
 * guide treats this as a status-bar affordance — visible at all times,
 * one-click to flip.
 *
 * Hydration: useTheme()'s `theme` and `resolvedTheme` are undefined on the
 * server. We render a no-op skeleton until mounted to avoid the SSR/CSR
 * mismatch that next-themes warns about. Layout shape is identical pre/
 * post-mount so nothing reflows.
 *
 * Persistence: next-themes' provider in app/layout.tsx is configured with
 * `attribute="class"` so the active mode is the `dark` class on <html>.
 * The provider already writes a localStorage key + the server reads a
 * `theme_choice` cookie for first-paint correctness — this component
 * doesn't touch either directly.
 */
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <div
      className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em]"
      aria-label="Color mode"
    >
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={
          "cursor-pointer bg-transparent p-0 transition-colors " +
          (isDark
            ? "text-highlight"
            : "text-muted-foreground hover:text-foreground")
        }
        aria-pressed={isDark}
      >
        [{isDark ? "x" : " "}] dark
      </button>
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={
          "cursor-pointer bg-transparent p-0 transition-colors " +
          (!isDark
            ? "text-highlight"
            : "text-muted-foreground hover:text-foreground")
        }
        aria-pressed={!isDark}
      >
        [{!isDark ? "x" : " "}] light
      </button>
    </div>
  );
}
