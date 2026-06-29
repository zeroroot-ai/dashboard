/**
 * Host-aware routing for the www/app split (deploy#630 S11, deploy#1033).
 *
 * ADR-0006 / deploy#1033: the marketing surface (home / pricing / contact-sales)
 * has moved to the SaaS-only www-svc (zeroroot-ai/www) served by nginx at
 * www.zeroroot.ai. The dashboard no longer serves go-to-market pages.
 *
 * In the SaaS deployment the Envoy www vhost now routes to gibson_www_svc (the
 * nginx static site), NOT to the dashboard. So www.<domain> requests never
 * reach this Next.js app in production SaaS.
 *
 * This module's HOST_SPLIT remains active for two remaining concerns:
 *   - app.<domain> `/` → `/dashboard` (product host has no landing, goes to
 *     dashboard which auth-gates to /login for unauthenticated users).
 *   - app.<domain> `/docs` → www.<domain>/docs (docs live at the www host in
 *     SaaS; dashboard no longer serves the docs surface directly).
 *
 * On self-hosted, WWW_URL is unset so HOST_SPLIT is null and no cross-host
 * redirects fire. `GET /` renders the root page, which now redirects to /login.
 *
 * Hostnames are CONFIG-DERIVED per deploy#630: the product origin comes from
 * AUTH_URL/NEXTAUTH_URL, the marketing origin from WWW_URL (wired by the Helm
 * chart from `global.domain`). When WWW_URL is unset (self-hosted), the split
 * is disabled.
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

/**
 * Paths on app.<domain> that should redirect to www.<domain>.
 * ADR-0006 / deploy#1033: pricing and contact-sales moved to the SaaS-only
 * www-svc (zeroroot-ai/www). Requests arriving at app.<domain>/pricing (e.g.
 * from old bookmarks) redirect to the canonical marketing host rather than
 * 404ing. Root "/" is handled separately (→ /dashboard, not www).
 */
const MARKETING_PREFIXES = ["/docs", "/pricing", "/contact-sales"] as const;

/**
 * Paths never host-redirected: assets, API + auth callbacks, health probes,
 * the internal design-tokens reference, and the crawler metadata files.
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
 * split is not configured — no WWW_URL, no app origin, or app === www
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
    // ADR-0006 / deploy#1033: in SaaS the Envoy www vhost routes to gibson_www_svc
    // (nginx) NOT to the dashboard, so www requests normally never reach here.
    // In dev (no separate www-svc), they may arrive here — apply the split:
    // marketing paths pass (dashboard could serve them in dev), product/auth
    // paths redirect to the app host so the auth flow works correctly.
    if (isMarketingPath(pathname)) return { kind: "pass" };
    // Product/auth path on the marketing host → product host.
    return { kind: "redirect", url: `${cfg.appOrigin}${pathname}${search}` };
  }

  // onApp (product host).
  if (pathname === "/") {
    // No landing on the product host — redirect to /dashboard.
    // Unauthenticated users land on /login via the auth middleware.
    return { kind: "redirect", url: `${cfg.appOrigin}/dashboard` };
  }
  if (isMarketingPath(pathname)) {
    // Docs (and any future marketing paths) redirect to the www host.
    return { kind: "redirect", url: `${cfg.wwwOrigin}${pathname}${search}` };
  }
  return { kind: "pass" };
}
