/**
 * BankFormDialog tests (gibson#1706 lane E1): the subscription shape is only
 * offered to a person owner, and the provider list follows the shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BankFormDialog } from "../BankFormDialog";
import type { BankView } from "@/src/lib/banks/view";

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock("@/src/hooks/useBanks", () => ({
  useCreateBank: () => ({ mutate: createMutate, isPending: false }),
  useUpdateBank: () => ({ mutate: updateMutate, isPending: false }),
}));

let tenantRole = "admin";
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ currentTenant: { id: "t1" }, rolesByTenant: { t1: tenantRole } }),
}));
vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", email: "u@x" } }, isPending: false, error: null, refetch: vi.fn() }),
}));

vi.mock("@/src/hooks/useProviders", () => ({
  useProviders: () => ({
    data: {
      providers: [
        { name: "anthropic-prod", displayName: "Anthropic prod", type: "anthropic" },
        { name: "aws-prod", displayName: "AWS prod", type: "bedrock" },
        { name: "gcp-prod", displayName: "GCP prod", type: "vertex" },
        { name: "openai-prod", displayName: "OpenAI prod", type: "openai" },
      ],
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Select renders its options into a portal on open; jsdom has no
// pointer capture. Use fireEvent on the trigger to open, as other suites do.
function renderCreate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BankFormDialog open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

function openSelect(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(trigger);
}

beforeEach(() => {
  tenantRole = "admin";
  createMutate.mockReset();
  updateMutate.mockReset();
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

describe("BankFormDialog, create", () => {
  it("offers the subscription shape when the person owns the bank", async () => {
    renderCreate();
    openSelect("bank-shape-select");
    expect(await screen.findByTestId("shape-option-subscription")).toBeInTheDocument();
  });

  it("drops the subscription shape when the tenant owns the bank", async () => {
    renderCreate();
    openSelect("bank-owner-select");
    fireEvent.click(await screen.findByRole("option", { name: "The tenant" }));
    await waitFor(() => expect(screen.getByTestId("bank-shape-select")).toHaveTextContent("Anthropic API key"));
    openSelect("bank-shape-select");
    await screen.findByTestId("shape-option-bedrock");
    expect(screen.queryByTestId("shape-option-subscription")).toBeNull();
  });

  it("lists only provider configurations that serve the chosen shape", async () => {
    renderCreate();
    openSelect("bank-shape-select");
    fireEvent.click(await screen.findByTestId("shape-option-bedrock"));
    openSelect("bank-provider-select");
    expect(await screen.findByTestId("provider-option-aws-prod")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-option-gcp-prod")).toBeNull();
    expect(screen.queryByTestId("provider-option-openai-prod")).toBeNull();
    expect(screen.queryByTestId("provider-option-anthropic-prod")).toBeNull();
  });

  it("a member cannot choose the tenant as owner", async () => {
    tenantRole = "member";
    renderCreate();
    openSelect("bank-owner-select");
    await screen.findByRole("option", { name: "Me" });
    expect(screen.queryByRole("option", { name: "The tenant" })).toBeNull();
  });

  it("refuses to submit a third-party shape without a provider configuration", async () => {
    renderCreate();
    fireEvent.change(screen.getByPlaceholderText("fix-crew"), { target: { value: "crew" } });
    openSelect("bank-shape-select");
    fireEvent.click(await screen.findByTestId("shape-option-vertex"));
    fireEvent.click(screen.getByTestId("bank-create-submit"));
    expect(await screen.findByText(/Pick the provider configuration/)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("submits a subscription bank with the form values", async () => {
    renderCreate();
    fireEvent.change(screen.getByPlaceholderText("fix-crew"), { target: { value: "crew" } });
    fireEvent.click(screen.getByTestId("bank-create-submit"));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const values = createMutate.mock.calls[0][0];
    expect(values).toMatchObject({ name: "crew", tenantOwned: false, loginShape: "subscription", desiredCount: 1, spillPolicy: "queue" });
  });
});

describe("BankFormDialog, edit", () => {
  const bank: BankView = {
    id: "b1",
    tenantId: "t1",
    owner: { kind: "user", id: "u1" },
    name: "crew",
    desiredCount: 2,
    loginShape: "bedrock",
    providerConfigName: "aws-prod",
    agentName: "claude",
    model: "",
    maxJobsInFlight: 1,
    staleLimitSeconds: 1800,
    spillPolicy: "ephemeral",
    createdAt: null,
    updatedAt: null,
  };

  it("edits count and policies only, and sends the partial", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BankFormDialog open onOpenChange={() => undefined} bank={bank} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("bank-shape-select")).toBeNull();
    expect(screen.queryByTestId("bank-provider-select")).toBeNull();
    const members = screen.getByLabelText("Members");
    fireEvent.change(members, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("bank-edit-submit"));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ desiredCount: 5, maxJobsInFlight: 1, staleLimitMinutes: 30, spillPolicy: "ephemeral" });
  });
});
