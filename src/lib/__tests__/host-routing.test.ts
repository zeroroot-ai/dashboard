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
  it("treats root + marketing prefixes as marketing", () => {
    for (const p of ["/", "/pricing", "/docs", "/docs/getting-started", "/contact-sales"]) {
      expect(isMarketingPath(p)).toBe(true);
    }
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
  it("does not flag product/marketing paths", () => {
    for (const p of ["/", "/dashboard", "/pricing"]) {
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
  it("serves marketing paths on www", () => {
    for (const p of ["/", "/pricing", "/docs/x", "/contact-sales"]) {
      expect(decideHostSplit("www.zeroroot.ai", p, "", cfg)).toEqual({ kind: "pass" });
    }
  });

  it("redirects product paths on www to the app host (preserving query)", () => {
    expect(decideHostSplit("www.zeroroot.ai", "/dashboard/missions", "?q=1", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/dashboard/missions?q=1",
    });
    expect(decideHostSplit("www.zeroroot.ai", "/login", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/login",
    });
  });

  it("redirects app root to /dashboard", () => {
    expect(decideHostSplit("app.zeroroot.ai", "/", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://app.zeroroot.ai:30443/dashboard",
    });
  });

  it("redirects marketing paths on app to the www host", () => {
    expect(decideHostSplit("app.zeroroot.ai", "/pricing", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/pricing",
    });
    expect(decideHostSplit("app.zeroroot.ai", "/docs/intro", "", cfg)).toEqual({
      kind: "redirect",
      url: "https://www.zeroroot.ai:30443/docs/intro",
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
