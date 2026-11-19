// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * After a save of new credentials the browser keeps no copy of them. This test
 * runs the dialog with the real update hook and a real QueryClient, and it
 * reads the mutation cache after the save.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { updateProvider } = vi.hoisted(() => ({ updateProvider: vi.fn() }));
vi.mock("@/src/lib/api/providers", async (orig) => ({
  ...(await orig<typeof import("@/src/lib/api/providers")>()),
  updateProvider,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EditCredentialsDialog } from "./EditCredentialsDialog";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client-types";

const SECRET = "sk-ant-new-key-do-not-keep";

const anthropic: SupportedProviderDescriptor = {
  type: "anthropic",
  displayName: "Anthropic (Claude)",
  docsUrl: "https://docs.anthropic.com/",
  selfHosted: false,
  credentials: [
    { key: "api_key", label: "Anthropic API Key", required: true, secret: true, placeholder: "sk-ant-...", help: "" },
  ],
  defaultModels: [],
};

/** Each variable that the mutation cache holds, as one text. */
function heldVariables(qc: QueryClient): string {
  return JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.variables ?? null));
}

describe("EditCredentialsDialog: the credential after a save", () => {
  it("leaves no credential in the mutation cache", async () => {
    let seen = "";
    updateProvider.mockImplementation(async (_name: string, config: { credentials: Record<string, string> }) => {
      seen = config.credentials.api_key;
      return { provider: { name: "claude-prod" } };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <EditCredentialsDialog
          descriptor={anthropic}
          providerName="claude-prod"
          displayName="Claude prod"
          open
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    await user.type(screen.getByPlaceholderText("Leave blank to keep existing value"), SECRET);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The save did send the credential, so the check below is not vacuous.
    expect(seen).toBe(SECRET);
    await waitFor(() => expect(heldVariables(qc)).not.toContain(SECRET));
  });
});
