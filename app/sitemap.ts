import type { MetadataRoute } from "next";

/**
 * sitemap.xml (Next.js metadata route).
 *
 * Only the public marketing surface belongs in the sitemap — the same
 * prefixes isMarketingPath() serves on the www host (src/lib/host-routing.ts).
 * Everything else is auth-walled product and is disallowed in robots.ts.
 *
 * Keep this list in sync with the marketing prefixes and the landing footer.
 */
const MARKETING_ORIGIN = (
  process.env.WWW_URL ?? "https://www.zeroroot.ai"
).replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
    { path: "/docs", priority: 0.8, changeFrequency: "daily" },
    { path: "/contact-sales", priority: 0.5, changeFrequency: "monthly" },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${MARKETING_ORIGIN}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
