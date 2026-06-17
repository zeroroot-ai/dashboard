import type { MetadataRoute } from "next";

/**
 * robots.txt (Next.js metadata route).
 *
 * The dashboard image serves BOTH the marketing host (www.zeroroot.ai) and
 * the product host (app.zeroroot.ai) from one Next app (see
 * src/lib/host-routing.ts), so this single file is what /robots.txt returns on
 * either host.
 *
 * Two policies, gated on environment:
 *
 *   - PRODUCTION (WWW_URL is the canonical prod marketing origin): fully open
 *     marketing surface ("/", "/pricing", "/docs", "/contact-sales") to all
 *     crawlers — classic search (SEO) AND AI/LLM crawlers (GPTBot, ClaudeBot,
 *     anthropic-ai, Google-Extended, PerplexityBot, CCBot, etc., all under "*")
 *     so the product is represented in frontier-model knowledge. See /llms.txt
 *     for the curated, LLM-friendly map. Auth-walled product / auth flows / API
 *     are disallowed to keep crawl budget on what matters.
 *   - NON-PRODUCTION (staging, preview, local dev — any other WWW_URL, or
 *     unset): `Disallow: /` for everyone. A publicly-reachable staging host
 *     (www.staging.zeroroot.ai) must never be indexed; that would leak the
 *     environment and create duplicate-content competition with prod.
 *
 * This route is `force-dynamic` because the environment is only known at
 * runtime: CI builds one image with no WWW_URL, and the Helm chart injects the
 * per-environment WWW_URL at pod startup. A statically-generated robots.txt
 * would bake the build-time fallback and could not distinguish prod from
 * staging.
 */
export const dynamic = "force-dynamic";

// The one host allowed to be crawled. Everything else fails closed to
// Disallow-all, so a new/renamed non-prod host is private by default.
const PROD_MARKETING_ORIGIN = "https://www.zeroroot.ai";

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
  const wwwUrl = (process.env.WWW_URL ?? "").replace(/\/$/, "");
  const isProd = wwwUrl === PROD_MARKETING_ORIGIN;

  if (!isProd) {
    // Non-prod: block everything. No sitemap — there is nothing to index here.
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${PROD_MARKETING_ORIGIN}/sitemap.xml`,
    host: PROD_MARKETING_ORIGIN,
  };
}
