import type { MetadataRoute } from "next";

/**
 * sitemap.xml (Next.js metadata route).
 *
 * ADR-0006 / deploy#1033: the marketing surface (home / pricing / contact-sales)
 * has moved to the SaaS-only www.zeroroot.ai site. The dashboard no longer
 * serves go-to-market pages.
 *
 * The product sitemap is intentionally empty — all auth-walled product paths
 * are disallowed in robots.ts and should not be indexed.
 *
 * The canonical marketing sitemap lives at https://www.zeroroot.ai/sitemap.xml
 * (served by the www-svc, zeroroot-ai/www). dashboard#823.
 */

export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
