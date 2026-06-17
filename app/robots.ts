import type { MetadataRoute } from "next";

/**
 * robots.txt (Next.js metadata route).
 *
 * The dashboard image serves BOTH the marketing host (www.zeroroot.ai) and
 * the product host (app.zeroroot.ai) from one Next app (see
 * src/lib/host-routing.ts), so this single file is what /robots.txt returns on
 * either host. Policy:
 *
 *   - Marketing surface is fully open: "/", "/pricing", "/docs",
 *     "/contact-sales" (the only prefixes isMarketingPath() serves on www).
 *     We WANT crawlers here — both classic search (SEO) and AI/LLM crawlers
 *     (so the product gets represented in frontier-model knowledge). See
 *     /llms.txt for the curated, LLM-friendly map.
 *   - Everything else is auth-walled product / auth flows / API and has no
 *     SEO value, so it is disallowed to keep crawl budget on the pages that
 *     matter and keep login/app routes out of the index.
 *
 * AI crawlers are intentionally NOT blocked. GPTBot, ClaudeBot, anthropic-ai,
 * Google-Extended, PerplexityBot, CCBot, etc. all fall under "*" and are
 * welcome on the public surface.
 */

// Marketing base origin. The chart wires WWW_URL to the canonical marketing
// host; fall back to the production host so a built image without WWW_URL
// (e.g. single-origin dev) still emits a sane, absolute Sitemap line.
const MARKETING_ORIGIN = (
  process.env.WWW_URL ?? "https://www.zeroroot.ai"
).replace(/\/$/, "");

// Non-public prefixes: product app, auth flows, API, internal reference. No
// indexable content lives under these.
const DISALLOW = [
  "/api/",
  "/dashboard",
  "/login",
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/select-tenant",
  "/onboarding",
  "/design-tokens",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${MARKETING_ORIGIN}/sitemap.xml`,
    host: MARKETING_ORIGIN,
  };
}
