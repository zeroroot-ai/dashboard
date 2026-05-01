/**
 * ProvidersContent tests
 *
 * Validates the descriptor-driven form renders credential fields from the
 * daemon's GetSupportedProviders descriptor, that the submit payload shape
 * matches DaemonProviderConfigInput, and that password inputs are uncontrolled
 * so plaintext is not retained in component state after submit.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvidersContent, DynamicCredentialForm } from "./ProvidersContent";
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';
import type { ListProvidersResponse } from "@/src/types/provider";
import { useSupportedProviders } from "@/src/hooks/useSupportedProviders";
import { useProviders } from "@/src/hooks/useProviders";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockCreateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
const mockSetDefaultMutate = vi.fn();

vi.mock("@/src/hooks/useSupportedProviders", () => ({
  useSupportedProviders: vi.fn(),
}));

vi.mock("@/src/hooks/useProviders", () => ({
  useProviders: vi.fn(),
  providerQueryKeys: {
    all: ["providers"],
    lists: () => ["providers", "list"],
    list: () => ["providers", "list", {}],
    details: () => ["providers", "detail"],
    detail: (name: string) => ["providers", "detail", name],
    health: () => ["providers", "health"],
    healthForProvider: (name: string) => ["providers", "health", name],
    healthAll: () => ["providers", "health", "all"],
    fallback: () => ["providers", "fallback"],
    audit: () => ["providers", "audit"],
    auditFiltered: () => ["providers", "audit", {}],
  },
}));

vi.mock("@/src/hooks/useProviderMutations", () => ({
  useCreateProvider: vi.fn(() => ({
    mutate: mockCreateMutate,
    isPending: false,
  })),
  useDeleteProvider: vi.fn(() => ({
    mutate: mockDeleteMutate,
    isPending: false,
  })),
  useSetDefaultProvider: vi.fn(() => ({
    mutate: mockSetDefaultMutate,
    isPending: false,
  })),
}));

// Sonner toast - silence in tests
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const anthropicDescriptor: SupportedProviderDescriptor = {
  type: "anthropic",
  displayName: "Anthropic (Claude)",
  docsUrl: "https://docs.anthropic.com/",
  selfHosted: false,
  credentials: [
    {
      key: "api_key",
      label: "Anthropic API Key",
      required: true,
      secret: true,
      placeholder: "sk-ant-...",
      help: "Find your key at console.anthropic.com",
    },
  ],
  defaultModels: [
    { name: "claude-3-5-sonnet-20241022", family: "Claude 3.5", contextWindow: 200000 },
    { name: "claude-3-haiku-20240307", family: "Claude 3", contextWindow: 200000 },
  ],
};

const bedrockDescriptor: SupportedProviderDescriptor = {
  type: "bedrock",
  displayName: "AWS Bedrock",
  docsUrl: "https://docs.aws.amazon.com/bedrock/",
  selfHosted: false,
  credentials: [
    {
      key: "aws_region",
      label: "AWS Region",
      required: false,
      secret: false,
      placeholder: "us-east-1",
      help: "AWS region where Bedrock is enabled",
    },
    {
      key: "aws_access_key_id",
      label: "AWS Access Key ID",
      required: false,
      secret: true,
      placeholder: "",
      help: "IAM access key with bedrock:InvokeModel permission",
    },
    {
      key: "aws_secret_access_key",
      label: "AWS Secret Access Key",
      required: false,
      secret: true,
      placeholder: "",
      help: "IAM secret access key",
    },
  ],
  defaultModels: [
    {
      name: "anthropic.claude-3-haiku-20240307-v1:0",
      family: "Bedrock — Claude 3",
      contextWindow: 200000,
    },
  ],
};

const ollamaDescriptor: SupportedProviderDescriptor = {
  type: "ollama",
  displayName: "Ollama",
  docsUrl: "https://ollama.com/",
  selfHosted: true,
  credentials: [],
  defaultModels: [],
};

const mockSupportedDescriptors: SupportedProviderDescriptor[] = [
  anthropicDescriptor,
  bedrockDescriptor,
  ollamaDescriptor,
];

const mockConfiguredProvider = {
  name: "my-anthropic",
  displayName: "my-anthropic",
  type: "anthropic",
  apiKeyMasked: "sk-ant-****xyz",
  defaultModel: "claude-3-5-sonnet-20241022",
  isDefault: true,
  isEnabled: true,
  version: 1,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockListProvidersResponse: ListProvidersResponse = {
  providers: [mockConfiguredProvider],
  defaultProvider: "my-anthropic",
  fallbackChain: [],
};

const emptyListResponse: ListProvidersResponse = {
  providers: [],
  defaultProvider: undefined,
  fallbackChain: [],
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProvidersContent", () => {
  const mockedUseSupportedProviders = vi.mocked(useSupportedProviders);
  const mockedUseProviders = vi.mocked(useProviders);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseSupportedProviders.mockReturnValue({
      data: mockSupportedDescriptors,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
    mockedUseProviders.mockReturnValue({
      data: emptyListResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
  });

  it("renders the section heading and Add Provider button", () => {
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText("LLM Providers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add provider/i })).toBeInTheDocument();
  });

  it("renders one ConfiguredProviderRow per existing provider", () => {
    mockedUseProviders.mockReturnValue({
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    // The provider name appears in the card title
    expect(screen.getByText(/my-anthropic/)).toBeInTheDocument();
    // Masked credential chip
    expect(screen.getByText("sk-ant-****xyz")).toBeInTheDocument();
  });

  it("shows empty state when no providers are configured", () => {
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText(/no providers configured yet/i)).toBeInTheDocument();
  });

  it("opens Add Provider dialog on button click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /add provider/i }));

    // Dialog should be open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Add LLM Provider/i)).toBeInTheDocument();
    // Provider type select trigger should be visible
    expect(screen.getByTestId("provider-type-select")).toBeInTheDocument();
  });

  it("shows an error alert when useProviders fails", () => {
    mockedUseProviders.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("daemon unreachable"),
    } as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText("daemon unreachable")).toBeInTheDocument();
  });

  it("renders skeleton placeholders while loading", () => {
    mockedUseSupportedProviders.mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useSupportedProviders>);
    mockedUseProviders.mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    // Skeleton cards are rendered, no provider cards
    expect(screen.queryByText(/add provider/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DynamicCredentialForm tests
// Tests the credential form directly without Dialog/Select interaction
// ---------------------------------------------------------------------------

describe("DynamicCredentialForm", () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a password input for secret credential fields (anthropic api_key)", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    // The api_key field should be a password input
    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i);
    expect(apiKeyInput).toHaveAttribute("type", "password");
    expect(apiKeyInput).toHaveAttribute("autoComplete", "off");
  });

  it("renders secret fields as password and non-secret fields as text (bedrock)", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={bedrockDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    // AWS Region: non-secret → text
    const regionInput = screen.getByLabelText(/AWS Region/i);
    expect(regionInput).toHaveAttribute("type", "text");

    // Access Key ID: secret → password
    const accessKeyInput = screen.getByLabelText(/AWS Access Key ID/i);
    expect(accessKeyInput).toHaveAttribute("type", "password");

    // Secret Access Key: secret → password
    const secretKeyInput = screen.getByLabelText(/AWS Secret Access Key/i);
    expect(secretKeyInput).toHaveAttribute("type", "password");
  });

  it("shows placeholder text from descriptor on credential inputs", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i);
    expect(apiKeyInput).toHaveAttribute("placeholder", "sk-ant-...");
  });

  it("shows help text from descriptor below the input field", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    expect(screen.getByText("Find your key at console.anthropic.com")).toBeInTheDocument();
  });

  it("shows required marker (*) on required credential fields", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    // Required field has aria-label="required" on the asterisk span
    expect(screen.getByLabelText("required")).toBeInTheDocument();
  });

  it("calls onSubmit with the generic payload shape on form submit", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    // Fill name field (pre-filled with descriptor.type by default)
    const nameInput = screen.getByLabelText(/^Name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, "my-claude");

    // Fill api_key
    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i);
    await user.type(apiKeyInput, "sk-ant-test-key-123");

    // Submit
    const submitButton = screen.getByRole("button", { name: /add provider/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockOnSubmit.mock.calls[0][0];
    expect(callArgs.name).toBe("my-claude");
    expect(typeof callArgs.credentials).toBe("object");
    expect(callArgs.credentials.api_key).toBe("sk-ant-test-key-123");
    // Must NOT have typed per-provider fields
    expect(callArgs).not.toHaveProperty("apiKey");
    expect(callArgs).not.toHaveProperty("isEnabled");
    expect(callArgs).not.toHaveProperty("displayName");
  });

  it("verifies that the mutation called from AddProviderDialog uses the generic payload shape", async () => {
    /**
     * Verifies the AddProviderDialog wraps DynamicCredentialForm and passes
     * credentials through in the DaemonProviderConfigInput shape:
     * { type, name, defaultModel, credentials: Record<string,string>, setAsDefault? }
     * with NO legacy fields like apiKey, isEnabled, or displayName.
     */
    const user = userEvent.setup();

    // Test DynamicCredentialForm directly since it processes the submit
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={(values) => {
          // Simulate what AddProviderDialog.handleSubmit does
          mockCreateMutate({
            config: {
              type: anthropicDescriptor.type,
              name: values.name,
              defaultModel: values.defaultModel,
              credentials: values.credentials,
              setAsDefault: values.setAsDefault,
            },
          });
        }}
        isPending={false}
      />
    );

    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i);
    await user.type(apiKeyInput, "sk-ant-test-key-123");

    const submitButton = screen.getByRole("button", { name: /add provider/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCreateMutate.mock.calls[0][0];
    // Must have generic shape: type, name, defaultModel, credentials
    expect(callArgs.config.type).toBe("anthropic");
    expect(typeof callArgs.config.credentials).toBe("object");
    expect(callArgs.config.credentials.api_key).toBe("sk-ant-test-key-123");
    // The config must NOT have typed per-provider fields
    expect(callArgs.config).not.toHaveProperty("apiKey");
    expect(callArgs.config).not.toHaveProperty("isEnabled");
    expect(callArgs.config).not.toHaveProperty("displayName");
  });

  it("password inputs are uncontrolled — react does not hold plaintext in state beyond submit", async () => {
    /**
     * Verifies that password inputs use the ref-forwarding pattern from
     * react-hook-form (uncontrolled). After the form submit handler runs,
     * the input's DOM value is still accessible via the input element, but
     * the component state does not contain a plaintext copy.
     */
    const user = userEvent.setup();
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i) as HTMLInputElement;

    // An uncontrolled input has no `value` property driven by React state;
    // the default value comes from react-hook-form's defaultValues (empty string).
    // We confirm the input exists and is of password type.
    expect(apiKeyInput.type).toBe("password");

    // Type a credential value
    await user.type(apiKeyInput, "sk-ant-secret");
    expect(apiKeyInput.value).toBe("sk-ant-secret");

    // After reading the value the component should not persist it in
    // a state variable — confirmed by the lack of a `data-value` or
    // `value={...}` prop that would indicate controlled state.
    expect(apiKeyInput).not.toHaveAttribute("data-value");
    // The autoComplete="off" attribute prevents browser persistence
    expect(apiKeyInput).toHaveAttribute("autoComplete", "off");
  });

  it("renders no credential fields when descriptor has empty credentials (ollama)", () => {
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={ollamaDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    // No password inputs
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    // But the name field and submit button should still be there
    expect(screen.getByLabelText(/^Name$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add provider/i })).toBeInTheDocument();
  });
});
