import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
import type { RedactedConfig } from "@/src/lib/gibson-client/tenant-broker-config";

function makeVaultConfig(): RedactedConfig {
  return {
    provider: 2, // BROKER_PROVIDER_VAULT — pre-existing config that's NOT gibson-hosted
    address: "https://vault.example.com",
    namespaceOrPath: "",
    mount: "",
    authMethod: "token",
    region: "",
    project: "",
    tenantIdExternal: "",
    clientId: "",
    roleArn: "",
    sensitiveFieldsSet: ["vault_token"],
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
  // Radix also queries hasPointerCapture / setPointerCapture / releasePointerCapture
  // on the trigger; jsdom returns undefined for these on HTMLElement.
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  // Radix' useSize calls ResizeObserver; jsdom doesn't have it.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("SecretsBackendForm migration warning", () => {
  it("does NOT show the migration warning when secretCount=0", async () => {
    render(<SecretsBackendForm currentConfig={makeVaultConfig()} secretCount={0} />);

    // Switch from Vault → AWS SM via the trigger.
    const trigger = screen.getByTestId("provider-switcher");
    fireEvent.click(trigger);
    const awsOption = await screen.findByRole("option", { name: /aws secrets manager/i });
    fireEvent.click(awsOption);

    // Migration warning must NOT be in the DOM.
    expect(screen.queryByTestId("migration-warning")).toBeNull();
    expect(screen.queryByTestId("acknowledge-migration")).toBeNull();
  });

  it("shows warning + checkbox when secretCount>0 AND provider differs; checkbox gates Save", async () => {
    render(<SecretsBackendForm currentConfig={makeVaultConfig()} secretCount={5} />);

    // Switch from Vault → AWS SM.
    const trigger = screen.getByTestId("provider-switcher");
    fireEvent.click(trigger);
    const awsOption = await screen.findByRole("option", { name: /aws secrets manager/i });
    fireEvent.click(awsOption);

    // Warning + checkbox visible.
    expect(screen.getByTestId("migration-warning")).toBeInTheDocument();
    const checkbox = screen.getByTestId("acknowledge-migration");
    expect(checkbox).toBeInTheDocument();

    // Save button is disabled until the checkbox is ticked.
    const save = screen.getByTestId("save-button");
    expect(save).toBeDisabled();

    fireEvent.click(checkbox);
    expect(save).not.toBeDisabled();
  });

  it("shows warning when secretCount=-1 (RPC unreachable, conservative path)", async () => {
    render(<SecretsBackendForm currentConfig={makeVaultConfig()} secretCount={-1} />);

    // Switch from Vault → AWS SM.
    const trigger = screen.getByTestId("provider-switcher");
    fireEvent.click(trigger);
    const awsOption = await screen.findByRole("option", { name: /aws secrets manager/i });
    fireEvent.click(awsOption);

    expect(screen.getByTestId("migration-warning")).toBeInTheDocument();
    // The conservative path includes the "Could not load current secret count"
    // muted-text caveat so operators understand why the warning is firing
    // even on what might be a brand-new tenant.
    expect(
      screen.getByText(/could not load current secret count/i),
    ).toBeInTheDocument();
  });

  it("resets the acknowledgement checkbox when the user picks a different provider", async () => {
    render(<SecretsBackendForm currentConfig={makeVaultConfig()} secretCount={3} />);

    // Switch Vault → AWS SM, tick the checkbox.
    const trigger = screen.getByTestId("provider-switcher");
    fireEvent.click(trigger);
    const aws = await screen.findByRole("option", { name: /aws secrets manager/i });
    fireEvent.click(aws);

    const checkbox1 = screen.getByTestId("acknowledge-migration");
    fireEvent.click(checkbox1);
    expect(screen.getByTestId("save-button")).not.toBeDisabled();

    // Now switch AWS SM → GCP SM. The acknowledgement should reset to
    // unchecked and Save should disable again.
    fireEvent.click(screen.getByTestId("provider-switcher"));
    const gcp = await screen.findByRole("option", { name: /gcp secret manager/i });
    fireEvent.click(gcp);

    const checkbox2 = screen.getByTestId("acknowledge-migration");
    expect((checkbox2 as HTMLInputElement & { dataset: { state?: string } }).dataset.state).not.toBe("checked");
    expect(screen.getByTestId("save-button")).toBeDisabled();
  });
});
