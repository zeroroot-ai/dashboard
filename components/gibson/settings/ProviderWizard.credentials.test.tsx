// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * After a good save the browser keeps no copy of the credential. This test
 * runs the wizard with the real mutation hook and a real QueryClient, and it
 * reads the mutation cache after the save.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { createProvider } = vi.hoisted(() => ({ createProvider: vi.fn() }));
vi.mock("@/src/lib/api/providers", async (orig) => ({
  ...(await orig<typeof import("@/src/lib/api/providers")>()),
  createProvider,
}));
// The test panel has its own tests. Here it only shows that step 3 started.
vi.mock("./ProviderTestPanel", () => ({
  ProviderTestPanel: ({ name }: { name: string }) => <div data-testid="test-panel">{name}</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProviderWizard } from "./ProviderWizard";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client-types";

const SECRET = "sk-ant-test-key-do-not-keep";

const anthropic: SupportedProviderDescriptor = {
  type: "anthropic",
  displayName: "Anthropic (Claude)",
  docsUrl: "https://docs.anthropic.com/",
  selfHosted: false,
  credentials: [
    { key: "api_key", label: "Anthropic API Key", required: true, secret: true, placeholder: "sk-ant-...", help: "" },
  ],
  defaultModels: [{ name: "claude-3-5-sonnet-20241022", family: "Claude 3.5", contextWindow: 200000 }],
};

/** Each variable that the mutation cache holds, as one text. */
function heldVariables(qc: QueryClient): string {
  return JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.variables ?? null));
}

describe("ProviderWizard: the credential after a save", () => {
  it("leaves no credential in the mutation cache and none in the page", async () => {
    let seen = "";
    createProvider.mockImplementation(async (config: { credentials: Record<string, string> }) => {
      seen = config.credentials.api_key;
      return { provider: { name: "claude-prod" } };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ProviderWizard supported={[anthropic]} initialType="anthropic" />
      </QueryClientProvider>,
    );
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "claude-prod");
    await user.type(screen.getByPlaceholderText("sk-ant-..."), SECRET);
    await user.type(screen.getByLabelText("Default chat model"), "claude-sonnet-4-5");
    await user.type(screen.getByLabelText(/context window/i), "200000");
    await user.click(screen.getByRole("button", { name: /save provider/i }));

    expect(await screen.findByTestId("test-panel")).toHaveTextContent("claude-prod");
    // The save did send the credential, so the check below is not vacuous.
    expect(seen).toBe(SECRET);
    await waitFor(() => expect(heldVariables(qc)).not.toContain(SECRET));
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data ?? null))).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(SECRET);
  });
});
