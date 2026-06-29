/**
 * Host-aware routing for the www/app split (deploy#630 S11).
 *
 * The platform is served from two external hosts that hit the SAME Next.js
 * app, so the marketing/product split is decided here by the Host header:
 *
 *   - www.<domain>  (+ apex, which Envoy 301-redirects to www) = MARKETING:
 *     landing (`/`), `/pricing`, `/docs/*`, `/contact-sales`.
 *   - app.<domain>  = PRODUCT: dashboard, auth/login/signup, everything else.
 *
 * Rules (owner-confirmed, deploy#641):
 *   - app `/`             -> `/dashboard`        (no landing on the product host)
 *   - app marketing path  -> www <same path>     (canonical marketing host)
 *   - www product path    -> app <same path>
 *   - www marketing path  -> served here
 *
 * Hostnames are CONFIG-DERIVED (no literals) per deploy#630: the product
 * origin comes from AUTH_URL/NEXTAUTH_URL, the marketing origin from WWW_URL,
 * both wired by the Helm chart from `global.domain` + the `gibson.*` helpers.
 * When WWW_URL is unset (single-origin local dev) the split is disabled.
 */

export interface HostSplitConfig {
  /** Bare host incl. port if any, e.g. "app.zeroroot.ai:30443". */
  appHost: string;
  /** Bare host incl. port if any, e.g. "www.zeroroot.ai:30443". */
  wwwHost: string;
  /** Full product origin, no trailing slash. */
  appOrigin: string;
  /** Full marketing origin, no trailing slash. */
  wwwOrigin: string;
}

type HostSplitDecision =
  | { kind: "pass" }
  | { kind: "redirect"; url: string };

/** Marketing path prefixes served on the www host. */
const MARKETING_PREFIXES = ["/pricing", "/docs", "/contact-sales"] as const;

/**
 * Paths never host-redirected: assets, API + auth callbacks, health probes,
 * the internal design-tokens reference, and the crawler metadata files. The
 * latter (`/robots.txt`, `/sitemap.xml`, `/llms.txt`) must resolve directly on
 * BOTH hosts — a 307 from the canonical marketing host (www) to the product
 * host (app) defeats the SEO/AI-crawler intent. Belt-and-suspenders alongside
 * the middleware matcher.
 */
const NEUTRAL_PREFIXES = [
  "/api",
  "/_next",
  "/design-tokens",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
] as const;

function bareHost(h: string): string {
  return h.split(":")[0]?.toLowerCase() ?? "";
}

function hostEquals(a: string, b: string): boolean {
  return bareHost(a) === bareHost(b) && bareHost(a) !== "";
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return MARKETING_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isNeutralPath(pathname: string): boolean {
  return NEUTRAL_PREFIXES.some(
    (p) =>
      pathname === p ||
      pathname.startsWith(`${p}/`) ||
      // file forms like /favicon.ico
      pathname.startsWith(`${p}.`),
  );
}

/**
 * Build the host-split config from the environment. Returns `null` when the
 * split is not configured, no WWW_URL, no app origin, or app === www
 * (single-origin local dev on localhost:3000), so dev is unaffected.
 */
export function loadHostSplitConfig(
  source: Record<string, string | undefined> = process.env,
): HostSplitConfig | null {
  const appOrigin = source.NEXTAUTH_URL || source.AUTH_URL;
  const wwwOrigin = source.WWW_URL;
  if (!appOrigin || !wwwOrigin) return null;
  let appHost: string;
  let wwwHost: string;
  try {
    appHost = new URL(appOrigin).host;
    wwwHost = new URL(wwwOrigin).host;
  } catch {
    return null;
  }
  if (hostEquals(appHost, wwwHost)) return null;
  return {
    appHost,
    wwwHost,
    appOrigin: stripTrailingSlash(appOrigin),
    wwwOrigin: stripTrailingSlash(wwwOrigin),
  };
}

/**
 * Decide whether a request passes through or redirects to the canonical host,
 * given the request Host header and path.
 */
export function decideHostSplit(
  requestHost: string,
  pathname: string,
  search: string,
  cfg: HostSplitConfig,
): HostSplitDecision {
  if (isNeutralPath(pathname)) return { kind: "pass" };

  const onApp = hostEquals(requestHost, cfg.appHost);
  const onWww = hostEquals(requestHost, cfg.wwwHost);
  // Unknown host (raw service DNS, localhost, probes), don't interfere.
  if (!onApp && !onWww) return { kind: "pass" };

  if (onWww) {
    if (isMarketingPath(pathname)) return { kind: "pass" };
    // Product/auth path on the marketing host -> product host.
    return { kind: "redirect", url: `${cfg.appOrigin}${pathname}${search}` };
  }

  // onApp (product host).
  if (pathname === "/") {
    // No landing on the product host, go straight to the dashboard.
    return { kind: "redirect", url: `${cfg.appOrigin}/dashboard` };
  }
  if (isMarketingPath(pathname)) {
    return { kind: "redirect", url: `${cfg.wwwOrigin}${pathname}${search}` };
  }
  return { kind: "pass" };
}
