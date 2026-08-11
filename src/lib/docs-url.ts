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
 * Server-derived, at call time: the chart renders `DOCS_URL` from
 * `gibson.docsOrigin` (global.domain), so each environment links to its own
 * docs host. Client components cannot read it — their server page computes
 * the href with `docsUrl()` and passes it down as a prop, the same
 * runtime-not-build-time pattern as STRIPE_PUBLISHABLE_KEY (dashboard#783).
 * The previous `NEXT_PUBLIC_DOCS_URL` read was set by nothing and would have
 * been inlined at image build time anyway, which pinned every environment's
 * docs links to prod (dashboard#1036).
 */
const DEFAULT_DOCS_ORIGIN = 'https://docs.zeroroot.ai';

/**
 * Build an absolute URL for a doc page.
 *
 * @param slug page path without a leading slash, e.g. `"missions"`.
 */
export function docsUrl(slug: string): string {
  const docsOrigin = (process.env.DOCS_URL || DEFAULT_DOCS_ORIGIN).replace(
    /\/$/,
    '',
  );
  const clean = slug.replace(/^\/+/, '');
  return `${docsOrigin}/docs/${clean}`;
}
