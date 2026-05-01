"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Light/Dark toggle.
 *
 * Compares against `resolvedTheme` (the actual rendered scheme — "light" or
 * "dark") rather than `theme` (which can be "system"). With `enableSystem`
 * on the ThemeProvider, the initial value of `theme` is "system" — the old
 * comparison `theme === "light"` was always false on first click, so the
 * toggle would jump to "light" even when the system was already light, and
 * the button felt broken. resolvedTheme always reflects what's on screen.
 */
export default function ThemeSwitch() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="relative"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
