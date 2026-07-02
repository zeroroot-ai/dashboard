import { describe, expect, it } from "vitest";
import {
  decideHostSplit,
  isMarketingPath,
  isNeutralPath,
  loadHostSplitConfig,
  type HostSplitConfig,
} from "../host-routing";

const cfg: HostSplitConfig = {
  appHost: "app.zeroroot.ai:30443",
  wwwHost: "www.zeroroot.ai:30443",
  appOrigin: "https://app.zeroroot.ai:30443",
  wwwOrigin: "https://www.zeroroot.ai:30443",
};

describe("isMarketingPath", () => {
  it("treats marketing prefixes as marketing (deploy#1033: pricing/contact-sales moved to www-svc)", () => {
    // ADR-0006 / deploy#1033: pricing and contact-sales are no longer served
    // by the dashboard — they live in the SaaS-only www-svc (www.zeroroot.ai).
    // They ARE still in MARKETING_PREFIXES so that requests to app.<domain>/pricing
    // redirect to the canonical marketing host rather than 404.
    for (const p of ["/pricing", "/docs", "/docs/getting-started", "/contact-sales"]) {
      expect(isMarketingPath(p)).toBe(true);
    }
  });
  it("root '/' is NOT a marketing path (handled separately as app-root → /dashboard)", () => {
    // ADR-0006: on the app host, '/' → /dashboard (not www).
    // The root is no longer a marketing landing — it redirects to /login (self-hosted)
    // or /dashboard (SaaS, via app-root special case in decideHostSplit).
    expect(isMarketingPath("/")).toBe(false);
  });
  it("treats product paths as non-marketing", () => {
    for (const p of ["/dashboard", "/login", "/signup", "/dashboard/missions", "/pricingx"]) {
      expect(isMarketingPath(p)).toBe(false);
    }
  });
});

describe("isNeutralPath", () => {
  it("flags assets/api/auth/design-tokens", () => {
    for (const p of ["/api", "/api/auth/callback", "/_next/static/x.js", "/design-tokens", "/favicon.ico"]) {
      expect(isNeutralPath(p)).toBe(true);
    }
  });
  it("flags crawler metadata files so they serve on both hosts (no www->app 307)", () => {
    for (const p of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
      expect(isNeutralPath(p)).toBe(true);
    }
  });
  it("does not flag product/marketing paths", () => {
    for (const p of ["/dashboard", "/pricing"]) {
      expect(isNeutralPath(p)).toBe(false);
    }
  });
});

describe("loadHostSplitConfig", () => {
  it("builds config from AUTH_URL + WWW_URL", () => {
    const c = loadHostSplitConfig({
      AUTH_URL: "https://app.zeroroot.ai:30443/",
      WWW_URL: "https://www.zeroroot.ai:30443",
    });
    expect(c).toEqual(cfg);
  });

  it("prefers NEXTAUTH_URL over AUTH_URL for the app origin", () => {
    const c = loadHostSplitConfig({
      NEXTAUTH_URL: "https://app.zeroroot.ai",
      AUTH_URL: "https://ignored.example",
      WWW_URL: "https://www.zeroroot.ai",
    });
    expect(c?.appOrigin).toBe("https://app.zeroroot.ai");
  });

  it("returns null when WWW_URL is unset (single-origin dev)", () => {
    expect(loadHostSplitConfig({ AUTH_URL: "http://localhost:3000" })).toBeNull();
  });

  it("returns null when app and www resolve to the same host", () => {
    expect(
      loadHostSplitConfig({
        AUTH_URL: "http://localhost:3000",
        WWW_URL: "http://localhost:3000",
      }),
    ).toBeNull();
  });

  it("returns null on malformed origins", () => {
    expect(
      loadHostSplitConfig({ AUTH_URL: "not a url", WWW_URL: "also bad" }),
    ).toBeNull();
  });
});

describe("decideHostSplit", () => {
  it("serves marketing paths on www (pass, in case dashboard is the www backend in dev)", () => {
    // ADR-0006 / deploy#1033: in SaaS, www requests go to gibson_www_svc (nginx),
    // not the dashboard. In dev, they may arrive here — marketing paths pass.
    for (const p of ["/pricing", "/docs/x", "/contact-sales"]) {
      expect(decideHostSplit("www.zeroroot.ai", p, "", cfg)).toEqual({ kind: "pass" });
    }
  });

  it("redirects product/auth paths on www to the app host (preserving query)", () => {
    expect(decideHostSplit("www.zeroroot.ai", "/dashboard/missions", "?q=1", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/dashboard/missions?q=1",
    });
    expect(decideHostSplit("www.zeroroot.ai", "/login", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/login",
    });
  });

  it("redirects app root to /dashboard (unauthenticated → /login via auth middleware)", () => {
    expect(decideHostSplit("app.zeroroot.ai", "/", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/dashboard",
    });
  });

  it("redirects marketing paths on app to the www host (deploy#1033: canonical www-svc origin)", () => {
    // /pricing and /contact-sales no longer live in the dashboard.
    // Requests that arrive at app.<domain>/pricing redirect to www (old bookmarks, etc.).
    expect(decideHostSplit("app.zeroroot.ai", "/pricing", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/pricing",
    });
    expect(decideHostSplit("app.zeroroot.ai", "/docs/intro", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/docs/intro",
    });
    expect(decideHostSplit("app.zeroroot.ai", "/contact-sales", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/contact-sales",
    });
  });

  it("passes product paths on app", () => {
    for (const p of ["/dashboard", "/login", "/dashboard/findings"]) {
      expect(decideHostSplit("app.zeroroot.ai", p, "", cfg)).toEqual({ kind: "pass" });
    }
  });

  it("passes neutral paths on either host", () => {
    expect(decideHostSplit("app.zeroroot.ai", "/api/auth/callback", "", cfg)).toEqual({ kind: "pass" });
    expect(decideHostSplit("www.zeroroot.ai", "/_next/static/a.js", "", cfg)).toEqual({ kind: "pass" });
  });

  it("matches hosts regardless of port presence in the Host header", () => {
    expect(decideHostSplit("app.zeroroot.ai:30443", "/pricing", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/pricing",
    });
  });

  it("passes unknown hosts untouched (raw service DNS, localhost, probes)", () => {
    expect(decideHostSplit("gibson-workloads-dashboard:3000", "/", "", cfg)).toEqual({ kind: "pass" });
    expect(decideHostSplit("", "/dashboard", "", cfg)).toEqual({ kind: "pass" });
  });
});
