/**
 * Unit tests for buildSocialProviders().
 *
 * With Auth.js v5 + Zitadel, social providers are configured in Zitadel
 * rather than the dashboard. buildSocialProviders() always returns an empty
 * enabled list and empty config.
 *
 * TODO(zitadel-envoy-gateway-migration): update tests if per-provider
 * IDP-hint buttons are implemented in future, see task 24 implementation log.
 */

import { describe, expect, it } from "vitest";

import {
  buildSocialProviders,
  PROVIDER_ORDER,
  type ProviderId,
} from "../social-providers";

describe("PROVIDER_ORDER", () => {
  it("exports canonical order: github → gitlab → google → microsoft", () => {
    expect(PROVIDER_ORDER).toEqual<ProviderId[]>(["github", "gitlab", "google", "microsoft"]);
  });
});

describe("buildSocialProviders (Zitadel mode)", () => {
  it("returns empty enabled list, social IdPs are configured in Zitadel", () => {
    const result = buildSocialProviders();
    expect(result.enabled).toEqual([]);
  });

  it("returns empty config object", () => {
    const result = buildSocialProviders();
    expect(result.config).toEqual({});
  });

  it("does not throw regardless of env vars", () => {
    expect(() => buildSocialProviders()).not.toThrow();
  });
});
