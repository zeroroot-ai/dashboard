/**
 * Where the customer documentation lives.
 *
 * The docs moved out of this app into their own deployable (docs-site, served
 * at the docs host) — see dashboard#820 and deploy ADR-0006. Links from the
 * product to a doc page are therefore cross-origin and must be absolute.
 *
 * Unlike `marketingUrl` on the deployment profile, this is never null. Docs
 * are a **core** component in ADR-0006's taxonomy, present in self-hosted as
 * well as SaaS (an air-gapped install ships a version-matched docs image), so
 * there is no posture in which the link should be omitted.
 *
 * `NEXT_PUBLIC_DOCS_URL` overrides the default for installs on their own
 * domain. It is `NEXT_PUBLIC_` because the consumers are client components;
 * the chart's server-side `DOCS_URL` cannot reach them.
 */
const DEFAULT_DOCS_ORIGIN = 'https://docs.zeroroot.ai';

/** Origin of the docs site, no trailing slash. */
const docsOrigin: string = (
  process.env.NEXT_PUBLIC_DOCS_URL || DEFAULT_DOCS_ORIGIN
).replace(/\/$/, '');

/**
 * Build an absolute URL for a doc page.
 *
 * @param slug page path without a leading slash, e.g. `"missions"`.
 */
export function docsUrl(slug: string): string {
  const clean = slug.replace(/^\/+/, '');
  return `${docsOrigin}/docs/${clean}`;
}
