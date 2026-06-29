import type { MetadataRoute } from "next";

/**
 * robots.txt (Next.js metadata route).
 *
 * ADR-0006 / deploy#1033: the marketing surface (home / pricing / contact-sales)
 * has moved to the SaaS-only www.zeroroot.ai site. The dashboard (app.zeroroot.ai)
 * no longer serves go-to-market pages.
 *
 * The dashboard is the product app — all paths are auth-walled and should not
 * be indexed. Disallow all crawlers unconditionally.
 *
 * The canonical marketing robots.txt lives at https://www.zeroroot.ai/robots.txt
 * (served by the www-svc, zeroroot-ai/www). dashboard#823.
 */

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
