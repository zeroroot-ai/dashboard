import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// useAuthorize is hit by the form to gate Probe/Save buttons. Stub to
// "allowed" for both RPCs so the Save button renders. The hook also
// returns loading: false synchronously.
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: () => ({ allowed: true, loading: false }),
}));

// The form imports server-action helpers; we never invoke them in these
// tests (we never click Save through to completion), but mocking them
// avoids 'server-only' import errors under jsdom.
vi.mock("@/app/actions/secrets-backend", () => ({
  probeBrokerConfigAction: vi.fn(),
  setBrokerConfigAction: vi.fn(),
}));

// sonner toasts: stub.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecretsBackendForm } from "../SecretsBackendForm";
import { BrokerProvider } from "@/src/gen/gibson/tenant/v1/secrets_pb";
import type { RedactedConfig } from "@/src/lib/gibson-client/tenant-broker-config";

const TENANT_ID = "tenant-abc";
const DEFAULT_PATH_PREFIX = `tenant/${TENANT_ID}`;

function makeConfig(
  provider: BrokerProvider,
  address = "",
  namespaceOrPath = "",
): RedactedConfig {
  return {
    provider,
    address,
    namespaceOrPath,
    mount: "",
    authMethod: "",
    region: "",
    project: "",
    tenantIdExternal: "",
    clientId: "",
    roleArn: "",
    sensitiveFieldsSet: [],
    updatedAtUnix: BigInt(0),
    updatedBy: "",
  } as unknown as RedactedConfig;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select calls scrollIntoView; jsdom doesn't have it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("SecretsBackendForm default-to-active selector", () => {
  it("defaults the selector to Hosted when the active backend is VAULT_HOSTED", () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    const trigger = screen.getByTestId("provider-switcher");
    expect(trigger).toHaveTextContent(/hosted/i);
    // Hosted renders the zero-config panel, not the BYO Vault address field.
    expect(screen.queryByText(/vault address/i)).toBeNull();
    expect(
      screen.getByText(/active for your tenant/i),
    ).toBeInTheDocument();
  });

  it("defaults the selector to BYO Vault when the active backend is VAULT_BYO", () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(
          BrokerProvider.VAULT_BYO,
          "https://vault.example.com",
        )}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    const trigger = screen.getByTestId("provider-switcher");
    expect(trigger).toHaveTextContent(/byo vault/i);
    // BYO renders the Vault sub-form (address field present).
    expect(screen.getByText(/vault address/i)).toBeInTheDocument();
  });

  it("defaults to Hosted when there is no config yet", () => {
    render(<SecretsBackendForm currentConfig={null} secretCount={0} tenantId={TENANT_ID} />);
    expect(screen.getByTestId("provider-switcher")).toHaveTextContent(/hosted/i);
  });
});

describe("SecretsBackendForm two-backend selector", () => {
  it("offers exactly Hosted and BYO Vault (no AWS/GCP/Azure)", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-switcher"));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    const labels = options.map((o) => o.textContent?.trim());
    expect(labels).toEqual(["Hosted", "BYO Vault"]);

    // No retired cloud backends.
    expect(
      within(listbox).queryByRole("option", { name: /aws|gcp|azure/i }),
    ).toBeNull();
  });
});

describe("SecretsBackendForm migration warning (Hosted ↔ BYO)", () => {
  it("does NOT show the migration warning when secretCount=0", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-switcher"));
    const byo = await screen.findByRole("option", { name: /byo vault/i });
    fireEvent.click(byo);

    expect(screen.queryByTestId("migration-warning")).toBeNull();
    // With nothing to migrate, Save is reachable and not gated.
    expect(screen.getByTestId("save-button")).not.toBeDisabled();
  });

  it("shows warning + checkbox when switching Hosted→BYO with existing secrets; checkbox gates Save", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={5}
        tenantId={TENANT_ID}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-switcher"));
    const byo = await screen.findByRole("option", { name: /byo vault/i });
    fireEvent.click(byo);

    expect(screen.getByTestId("migration-warning")).toBeInTheDocument();
    const checkbox = screen.getByTestId("acknowledge-migration");
    const save = screen.getByTestId("save-button");
    expect(save).toBeDisabled();

    fireEvent.click(checkbox);
    expect(save).not.toBeDisabled();
  });
});

describe("SecretsBackendForm BYO path-prefix prefill", () => {
  it("prefills the path prefix with tenant/<tenant-id> when BYO is active and no value is saved", () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(
          BrokerProvider.VAULT_BYO,
          "https://vault.example.com",
        )}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    const prefix = screen.getByPlaceholderText("tenant/your-tenant");
    expect(prefix).toHaveValue(DEFAULT_PATH_PREFIX);
  });

  it("keeps the saved path prefix over the tenant-scoped default", () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(
          BrokerProvider.VAULT_BYO,
          "https://vault.example.com",
          "custom/kv/path",
        )}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    expect(screen.getByPlaceholderText("tenant/your-tenant")).toHaveValue(
      "custom/kv/path",
    );
  });

  it("prefills the path prefix after switching Hosted→BYO", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    fireEvent.click(screen.getByTestId("provider-switcher"));
    fireEvent.click(await screen.findByRole("option", { name: /byo vault/i }));

    expect(screen.getByPlaceholderText("tenant/your-tenant")).toHaveValue(
      DEFAULT_PATH_PREFIX,
    );
  });
});

describe("SecretsBackendForm preserve-on-switch", () => {
  it("does not blank typed BYO values when switching provider away and back", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(
          BrokerProvider.VAULT_BYO,
          "https://vault.example.com",
        )}
        secretCount={0}
        tenantId={TENANT_ID}
      />,
    );

    // Type a custom address into the BYO sub-form.
    const address = screen.getByPlaceholderText(
      "https://vault.example.com:8200",
    );
    fireEvent.change(address, { target: { value: "https://my-vault:8200" } });
    expect(address).toHaveValue("https://my-vault:8200");

    // Switch to Hosted (BYO sub-form unmounts) …
    fireEvent.click(screen.getByTestId("provider-switcher"));
    fireEvent.click(await screen.findByRole("option", { name: /hosted/i }));
    expect(screen.queryByPlaceholderText("https://vault.example.com:8200")).toBeNull();

    // … then back to BYO: the typed address must still be there.
    fireEvent.click(screen.getByTestId("provider-switcher"));
    fireEvent.click(await screen.findByRole("option", { name: /byo vault/i }));

    expect(
      screen.getByPlaceholderText("https://vault.example.com:8200"),
    ).toHaveValue("https://my-vault:8200");
  });
});
