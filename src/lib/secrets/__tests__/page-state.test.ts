import { describe, it, expect } from "vitest";

import { resolveSecretsBackendView } from "../page-state";
import { BrokerProvider } from "@/src/gen/gibson/tenant/v1/secrets_pb";

describe("resolveSecretsBackendView", () => {
  it("is 'unavailable' only when the broker is unreachable", () => {
    expect(resolveSecretsBackendView({ reachable: false })).toBe("unavailable");
    expect(
      resolveSecretsBackendView({
        reachable: false,
        provider: BrokerProvider.VAULT_HOSTED,
      }),
    ).toBe("unavailable");
  });

  it("is 'byo' when the active backend is VAULT_BYO", () => {
    expect(
      resolveSecretsBackendView({
        reachable: true,
        provider: BrokerProvider.VAULT_BYO,
      }),
    ).toBe("byo");
  });

  it("is 'hosted' when the active backend is VAULT_HOSTED", () => {
    expect(
      resolveSecretsBackendView({
        reachable: true,
        provider: BrokerProvider.VAULT_HOSTED,
      }),
    ).toBe("hosted");
  });

  it("defaults a reachable-but-unspecified backend to 'hosted' (add-secret reachable, no dead-end)", () => {
    // A provisioned Hosted tenant is always active even if the provider enum
    // is unspecified/unseeded — the add-secret path must stay reachable.
    expect(resolveSecretsBackendView({ reachable: true })).toBe("hosted");
    expect(
      resolveSecretsBackendView({
        reachable: true,
        provider: BrokerProvider.UNSPECIFIED,
      }),
    ).toBe("hosted");
  });
});
