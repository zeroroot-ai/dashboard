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

function makeConfig(provider: BrokerProvider, address = ""): RedactedConfig {
  return {
    provider,
    address,
    namespaceOrPath: "",
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
      />,
    );

    const trigger = screen.getByTestId("provider-switcher");
    expect(trigger).toHaveTextContent(/byo vault/i);
    // BYO renders the Vault sub-form (address field present).
    expect(screen.getByText(/vault address/i)).toBeInTheDocument();
  });

  it("defaults to Hosted when there is no config yet", () => {
    render(<SecretsBackendForm currentConfig={null} secretCount={0} />);
    expect(screen.getByTestId("provider-switcher")).toHaveTextContent(/hosted/i);
  });
});

describe("SecretsBackendForm two-backend selector", () => {
  it("offers exactly Hosted and BYO Vault (no AWS/GCP/Azure)", async () => {
    render(
      <SecretsBackendForm
        currentConfig={makeConfig(BrokerProvider.VAULT_HOSTED)}
        secretCount={0}
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
