/**
 * Brand marks — ported from the design handoff (`zero-day-ai/project/marks.jsx`).
 *
 * Five exports:
 *   • Brain      — standalone slashed-zero (compact icon, favicon scale)
 *   • BrainCRT   — primary mark: CRT bezel + slashed-zero on screen + stand
 *   • Wordmark   — "zero-day.ai" with .ai dimmed
 *   • Lockup     — mark + wordmark, horizontal
 *   • Avatar     — square tile with the slashed-zero (GitHub org, app icon)
 *
 * All marks paint via `currentColor` and inherit from the surrounding
 * `color: var(--primary)` (or whatever class the parent sets), so they
 * auto-theme between light + dark without conditional styling.
 *
 * `Logo` (default export) is a sidebar-sized BrainCRT so existing
 * `import Logo from "@/components/layout/logo"` call sites keep working.
 */

import type { CSSProperties, ReactNode } from "react";

interface BrainProps {
  size?: number;
  className?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
}

/** Standalone slashed-zero (Ø-style glyph). Used at small sizes and on tiles. */
export function Brain({
  size = 64,
  className,
  "aria-label": ariaLabel = "zero-day mark",
  "aria-hidden": ariaHidden,
}: BrainProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden}
      role={ariaHidden ? "presentation" : "img"}
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M 18 6 H 46 A 6 6 0 0 1 52 12 V 52 A 6 6 0 0 1 46 58 H 18 A 6 6 0 0 1 12 52 V 12 A 6 6 0 0 1 18 6 Z
           M 22 14 H 42 A 2 2 0 0 1 44 16 V 48 A 2 2 0 0 1 42 50 H 22 A 2 2 0 0 1 20 48 V 16 A 2 2 0 0 1 22 14 Z"
      />
      <line
        x1="6"
        y1="58"
        x2="58"
        y2="6"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="butt"
      />
    </svg>
  );
}

interface BrainCRTProps extends BrainProps {
  /** Adds a phosphor drop-shadow keyed off --glow-strength (0 light · 1 dark). */
  glow?: boolean;
  /** Renders the monitor stand. Turn off for tight nav contexts. */
  stem?: boolean;
}

/** Primary mark — CRT bezel with the slashed zero on the screen. */
export function BrainCRT({
  size = 96,
  glow = true,
  stem = true,
  className,
  "aria-label": ariaLabel = "zero-day.ai",
  "aria-hidden": ariaHidden,
}: BrainCRTProps) {
  // Glow uses currentColor + --glow-strength so light mode (strength: 0)
  // produces no blur and dark mode (strength: 1) produces a phosphor halo.
  const filter: CSSProperties["filter"] = glow
    ? "drop-shadow(0 0 calc(6px * var(--glow-strength, 0)) color-mix(in oklch, currentColor 45%, transparent))"
    : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden}
      role={ariaHidden ? "presentation" : "img"}
      style={{ filter }}
    >
      <rect
        x="3"
        y="6"
        width="58"
        height="44"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <rect
        x="8"
        y="11"
        width="48"
        height="34"
        rx="1"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeOpacity="0.5"
      />
      <g stroke="currentColor" strokeOpacity="0.10" strokeWidth="0.5">
        {[14, 17, 20, 23, 26, 29, 32, 35, 38, 41].map((y) => (
          <line key={y} x1="9" y1={y} x2="55" y2={y} />
        ))}
      </g>
      <g>
        <path
          fillRule="evenodd"
          fill="currentColor"
          d="M 19 13 H 45 A 5 5 0 0 1 50 18 V 38 A 5 5 0 0 1 45 43 H 19 A 5 5 0 0 1 14 38 V 18 A 5 5 0 0 1 19 13 Z
             M 23 20 H 41 A 2 2 0 0 1 43 22 V 34 A 2 2 0 0 1 41 36 H 23 A 2 2 0 0 1 21 34 V 22 A 2 2 0 0 1 23 20 Z"
        />
        <line
          x1="11"
          y1="44"
          x2="53"
          y2="12"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="butt"
        />
      </g>
      {stem ? (
        <g>
          <rect x="26" y="50" width="12" height="4" fill="currentColor" />
          <rect x="18" y="54" width="28" height="3" fill="currentColor" />
        </g>
      ) : null}
      <rect x="54" y="46" width="2" height="2" fill="currentColor">
        <animate
          attributeName="opacity"
          values="1;1;0.3;1"
          dur="2.4s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

interface WordmarkProps {
  size?: number;
  /** Dim the .ai suffix relative to the host word. */
  dim?: boolean;
  variant?: "full" | "short";
  className?: string;
}

/** "zero-day.ai" with .ai dimmed; "0d.ai" if `variant="short"`. */
export function Wordmark({
  size = 32,
  dim = true,
  variant = "full",
  className,
}: WordmarkProps) {
  const baseStyle: CSSProperties = {
    font: `800 ${size}px/1 var(--font-mono)`,
    letterSpacing: "-0.04em",
    color: "var(--foreground)",
    display: "inline-flex",
    alignItems: "baseline",
    gap: 0,
  };
  const dimStyle: CSSProperties = {
    color: dim ? "var(--muted-foreground)" : "inherit",
    fontWeight: 600,
  };

  if (variant === "short") {
    return (
      <span className={className} style={baseStyle}>
        <span>0d</span>
        <span style={dimStyle}>.ai</span>
      </span>
    );
  }

  return (
    <span className={className} style={baseStyle}>
      <span>zero-day</span>
      <span style={dimStyle}>.ai</span>
    </span>
  );
}

type LockupSize = "sm" | "md" | "lg" | "xl";
interface LockupProps {
  size?: LockupSize;
  className?: string;
  /** Override the mark color. Defaults to var(--primary). */
  markColor?: string;
}

const LOCKUP_SIZES: Record<LockupSize, { mark: number; word: number; gap: number }> = {
  sm: { mark: 28, word: 16, gap: 10 },
  md: { mark: 44, word: 24, gap: 14 },
  lg: { mark: 64, word: 36, gap: 18 },
  xl: { mark: 96, word: 56, gap: 24 },
};

/** Horizontal mark + wordmark — primary lockup for nav, headers, README.
 *
 * The full mark (with stem) is the canonical brand mark — same as the
 * square 75mm sticker treatment in the brand guide. Stem stays on at
 * every size so the lockup reads as "a terminal next to a wordmark",
 * not "a screen next to a wordmark". */
export function Lockup({ size = "md", className, markColor }: LockupProps) {
  const s = LOCKUP_SIZES[size];
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        color: markColor ?? "var(--primary)",
      }}
    >
      <BrainCRT size={s.mark} stem aria-hidden />
      <Wordmark size={s.word} />
    </span>
  );
}

interface AvatarProps {
  size?: number;
  /** Border radius in px. Default = 12 → terminal-square. */
  radius?: number;
  className?: string;
  children?: ReactNode;
}

/** Square tile — GitHub org avatar, app icon, sticker. */
export function Avatar({ size = 96, radius = 12, className }: AvatarProps) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--background)",
        border: "1.5px solid var(--primary)",
        boxShadow:
          "0 0 calc(12px * var(--glow-strength, 0)) color-mix(in oklch, var(--primary) 35%, transparent)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--primary)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <Brain size={Math.round(size * 0.6)} aria-hidden />
    </span>
  );
}

/**
 * Default export — drop-in replacement for the previous raster `/logo.png`.
 * Sized to match the legacy 30px placeholder so the sidebar collapsible
 * doesn't reflow.
 */
export default function Logo() {
  return (
    <span
      className="me-1 inline-flex shrink-0 items-center justify-center transition-all group-data-collapsible:size-6 group-data-[collapsible=icon]:size-8"
      style={{
        width: 30,
        height: 30,
        color: "var(--primary)",
      }}
      aria-label="Zero Day AI"
      role="img"
    >
      <BrainCRT size={30} stem={false} aria-hidden />
    </span>
  );
}
