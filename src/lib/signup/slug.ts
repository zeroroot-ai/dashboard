/**
 * slugify, derives a tenant slug from a workspace display name.
 *
 * Mirrors the implementation in app/actions/signup.ts so the client can
 * preview the same slug the server will compute. Keep these in sync.
 *
 * Spec: tenant-provisioning-unification-phase2 Requirement 4.5.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

/**
 * isReservedSlug returns true when `slug` matches the chart-managed
 * denylist, either an exact entry or a registered prefix.
 */
export function isReservedSlug(
  slug: string,
  denylist: { exact: string[]; prefix: string[] },
): boolean {
  if (!slug) return false;
  if (denylist.exact.includes(slug)) return true;
  return denylist.prefix.some((p) => p && slug.startsWith(p));
}
