"use client";

/**
 * Stripe Elements appearance, built from the dashboard's live CSS tokens.
 *
 * Extracted from the signup form when the card step moved to the completion
 * screen (it now runs after the address is proven, not before). Reading the
 * live token rather than a literal keeps the no-hardcoded-colors guard honest
 * AND makes the embedded iframe match the theme exactly.
 */

import type { Appearance } from "@stripe/stripe-js";

// Resolve a CSS custom-property value to a concrete color string the Stripe
// Elements iframe can parse. The design tokens are oklch(); Stripe's appearance
// API does not parse oklch reliably, so paint the value onto a throwaway element
// and read back the browser-computed rgb(). Reading the live token (never a
// hardcoded literal) keeps the no-hardcoded-colors guard happy AND guarantees an
// exact match to the dashboard theme.
function resolveToken(cs: CSSStyleDeclaration, name: string): string {
  const raw = cs.getPropertyValue(name).trim();
  if (!raw || typeof document === "undefined") return raw;
  const probe = document.createElement("span");
  probe.style.color = raw;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb || raw;
}

// Build a Stripe Elements appearance from the dashboard's live CSS tokens so the
// inline Payment Element matches the single dark brand exactly (dashboard#784
// follow-up: the default light theme rendered a white box that clashed). Runs
// client-side only (reads the DOM).
export function buildStripeAppearance(): Appearance {
  const cs = getComputedStyle(document.documentElement);
  const t = (n: string) => resolveToken(cs, n);
  const radius = cs.getPropertyValue("--radius").trim() || "0.5rem";
  return {
    theme: "night",
    variables: {
      fontFamily: cs.getPropertyValue("--font-sans").trim() || "inherit",
      borderRadius: radius,
      colorPrimary: t("--primary"),
      colorBackground: t("--input"),
      colorText: t("--foreground"),
      colorTextSecondary: t("--muted-foreground"),
      colorTextPlaceholder: t("--muted-foreground"),
      colorDanger: t("--destructive"),
    },
    rules: {
      ".Input": { border: `1px solid ${t("--border")}` },
      ".Input:focus": { boxShadow: `0 0 0 1px ${t("--ring")}` },
      ".Label": { color: t("--muted-foreground") },
      ".Tab": { border: `1px solid ${t("--border")}` },
      ".Tab--selected": { borderColor: t("--primary") },
    },
  };
}

