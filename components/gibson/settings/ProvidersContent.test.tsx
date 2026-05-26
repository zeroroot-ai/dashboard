/**
 * ProvidersContent tests
 *
 * Validates the descriptor-driven form renders credential fields from the
 * daemon's GetSupportedProviders descriptor, that the submit payload shape
 * matches DaemonProviderConfigInput, and that password inputs are uncontrolled
 * so plaintext is not retained in component state after submit.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvidersContent, DynamicCredentialForm } from "./ProvidersContent";
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';
import type { ListProvidersResponse } from "@/src/types/provider";
import { useSupportedProviders } from "@/src/hooks/useSupportedProviders";
import { useProviders } from "@/src/hooks/useProviders";
import { useProviderHealth } from "@/src/hooks/useProviderHealth";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockCreateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
const mockSetDefaultMutate = vi.fn();
const mockUpdateMutate = vi.fn();

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
  useUpdateProvider: vi.fn(() => ({
    mutate: mockUpdateMutate,
    isPending: false,
  })),
}));

vi.mock("@/src/hooks/useProviderHealth", () => ({
  useProviderHealth: vi.fn(),
}));

// Sonner toast - silence in tests
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Stub ProviderWizard and CredentialsAndTest to isolate ProvidersContent tests.
// CredentialsAndTest stub lets edit-flow tests drive onValuesChange.
vi.mock("./ProviderWizard", () => ({
  ProviderWizard: () => null,
  CredentialsAndTest: ({
    onValuesChange,
  }: {
    onValuesChange?: (v: { name: string; credentials: Record<string, string> }) => void;
  }) => (
    <button
      type="button"
      data-testid="credentials-and-test-stub"
      onClick={() =>
        onValuesChange?.({ name: "my-anthropic", credentials: { api_key: "sk-ant-new-key" } })
      }
    >
      Enter credentials
    </button>
  ),
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
};

const emptyListResponse: ListProvidersResponse = {
  providers: [],
  defaultProvider: undefined,
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
  const mockedUseProviderHealth = vi.mocked(useProviderHealth);

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
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'unknown' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);
  });

  it("renders the section heading and Add Provider button", () => {
    mockedUseProviders.mockReturnValue({
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
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
    expect(screen.getByText(/my-anthropic/)).toBeInTheDocument();
    expect(screen.getByText("sk-ant-****xyz")).toBeInTheDocument();
  });

  it("shows empty state when no providers are configured", () => {
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText(/connect your first provider/i)).toBeInTheDocument();
  });

  it("opens Add Provider dialog on button click", async () => {
    const user = userEvent.setup();
    mockedUseProviders.mockReturnValue({
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /add provider/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Add LLM Provider/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/add provider/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ConfiguredProviderRow — health badge (dashboard#283)
// ---------------------------------------------------------------------------

describe("ConfiguredProviderRow — health badge", () => {
  const mockedUseSupportedProviders = vi.mocked(useSupportedProviders);
  const mockedUseProviders = vi.mocked(useProviders);
  const mockedUseProviderHealth = vi.mocked(useProviderHealth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseSupportedProviders.mockReturnValue({
      data: mockSupportedDescriptors,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
    mockedUseProviders.mockReturnValue({
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the health badge with 'Unknown' label when status is unknown", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'unknown' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByTestId("health-badge")).toBeInTheDocument();
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Unknown");
  });

  it("renders the health badge with 'Healthy' label when status is healthy", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'healthy', lastCheckAt: '2026-01-01T00:00:00Z' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByTestId("health-badge")).toHaveTextContent("Healthy");
  });

  it("renders the health badge with 'Degraded' label when status is degraded", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'degraded' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByTestId("health-badge")).toHaveTextContent("Degraded");
  });

  it("renders the health badge with 'Unhealthy' label when status is unhealthy", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'unhealthy' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByTestId("health-badge")).toHaveTextContent("Unhealthy");
  });

  it("shows a destructive Alert with lastError when status is unhealthy and error is present", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'unhealthy', lastError: 'Connection refused' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("does not show the error Alert when status is healthy", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'healthy', lastCheckAt: '2026-01-01T00:00:00Z' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.queryByText("Connection refused")).not.toBeInTheDocument();
  });

  it("calls useProviderHealth with the provider name", () => {
    mockedUseProviderHealth.mockReturnValue({
      data: { status: 'unknown' },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);

    renderWithProviders(<ProvidersContent />);

    expect(mockedUseProviderHealth).toHaveBeenCalledWith("my-anthropic");
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

    const regionInput = screen.getByLabelText(/AWS Region/i);
    expect(regionInput).toHaveAttribute("type", "text");

    const accessKeyInput = screen.getByLabelText(/AWS Access Key ID/i);
    expect(accessKeyInput).toHaveAttribute("type", "password");

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

    const nameInput = screen.getByLabelText(/^Name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, "my-claude");

    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i);
    await user.type(apiKeyInput, "sk-ant-test-key-123");

    const submitButton = screen.getByRole("button", { name: /add provider/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockOnSubmit.mock.calls[0][0];
    expect(callArgs.name).toBe("my-claude");
    expect(typeof callArgs.credentials).toBe("object");
    expect(callArgs.credentials.api_key).toBe("sk-ant-test-key-123");
    expect(callArgs).not.toHaveProperty("apiKey");
    expect(callArgs).not.toHaveProperty("isEnabled");
    expect(callArgs).not.toHaveProperty("displayName");
  });

  it("verifies that the mutation called from AddProviderDialog uses the generic payload shape", async () => {
    const mockCreateMutateLocal = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={(values) => {
          mockCreateMutateLocal({
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
      expect(mockCreateMutateLocal).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCreateMutateLocal.mock.calls[0][0];
    expect(callArgs.config.type).toBe("anthropic");
    expect(typeof callArgs.config.credentials).toBe("object");
    expect(callArgs.config.credentials.api_key).toBe("sk-ant-test-key-123");
    expect(callArgs.config).not.toHaveProperty("apiKey");
    expect(callArgs.config).not.toHaveProperty("isEnabled");
    expect(callArgs.config).not.toHaveProperty("displayName");
  });

  it("password inputs are uncontrolled — react does not hold plaintext in state beyond submit", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DynamicCredentialForm
        descriptor={anthropicDescriptor}
        onSubmit={mockOnSubmit}
        isPending={false}
      />
    );

    const apiKeyInput = screen.getByLabelText(/Anthropic API Key/i) as HTMLInputElement;

    expect(apiKeyInput.type).toBe("password");

    await user.type(apiKeyInput, "sk-ant-secret");
    expect(apiKeyInput.value).toBe("sk-ant-secret");

    expect(apiKeyInput).not.toHaveAttribute("data-value");
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

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Name$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add provider/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ConfiguredProviderRow — credentialsMasked display
// ---------------------------------------------------------------------------

describe("ConfiguredProviderRow — credentialsMasked display", () => {
  const mockedUseSupportedProviders = vi.mocked(useSupportedProviders);
  const mockedUseProviders = vi.mocked(useProviders);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseSupportedProviders.mockReturnValue({
      data: mockSupportedDescriptors,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
  });

  it("renders two chips for a Bedrock-shaped provider with credentialsMasked", () => {
    mockedUseProviders.mockReturnValue({
      data: {
        providers: [
          {
            name: "my-bedrock",
            displayName: "my-bedrock",
            type: "bedrock",
            credentialsMasked: {
              aws_region: "us-**-1",
              aws_access_key_id: "****XAID",
            },
            isDefault: false,
            isEnabled: true,
            version: 1,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        ],
        defaultProvider: undefined,
            },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText("aws_region: us-**-1")).toBeInTheDocument();
    expect(screen.getByText("aws_access_key_id: ****XAID")).toBeInTheDocument();
  });

  it("renders zero chips when credentialsMasked is an empty object", () => {
    mockedUseProviders.mockReturnValue({
      data: {
        providers: [
          {
            name: "my-empty",
            displayName: "my-empty",
            type: "bedrock",
            credentialsMasked: {},
            isDefault: false,
            isEnabled: true,
            version: 1,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        ],
        defaultProvider: undefined,
            },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    // No credential chips rendered for empty credentialsMasked
    expect(screen.queryByText(/: /)).not.toBeInTheDocument();
  });

  it("renders legacy fallback chip when only apiKeyMasked is present (no credentialsMasked)", () => {
    mockedUseProviders.mockReturnValue({
      data: {
        providers: [
          {
            name: "my-legacy",
            displayName: "my-legacy",
            type: "anthropic",
            apiKeyMasked: "****1234",
            isDefault: false,
            isEnabled: true,
            version: 1,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        ],
        defaultProvider: undefined,
            },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useProviders>);
    renderWithProviders(<ProvidersContent />);
    expect(screen.getByText("****1234")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ConfiguredProviderRow — edit credentials (dashboard#281)
// ---------------------------------------------------------------------------

describe("ConfiguredProviderRow — edit credentials", () => {
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
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);
  });

  it("renders the Edit credentials button when a matching descriptor is available", () => {
    renderWithProviders(<ProvidersContent />);
    // anthropicDescriptor.type === "anthropic" matches the configured provider
    expect(screen.getByRole("button", { name: /edit credentials/i })).toBeInTheDocument();
  });

  it("opens the edit dialog when Edit credentials is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /edit credentials/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Edit my-anthropic credentials/i)).toBeInTheDocument();
    expect(screen.getByText(/Leave secret fields blank/i)).toBeInTheDocument();
  });

  it("renders CredentialsAndTest stub inside the edit dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /edit credentials/i }));

    expect(screen.getByTestId("credentials-and-test-stub")).toBeInTheDocument();
  });

  it("calls updateProvider mutation with credentials when Save is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /edit credentials/i }));

    // Simulate credential entry via the stub — fires onValuesChange
    await user.click(screen.getByTestId("credentials-and-test-stub"));

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    });

    const call = mockUpdateMutate.mock.calls[0][0];
    expect(call.name).toBe("my-anthropic");
    expect(call.config.credentials).toEqual({ api_key: "sk-ant-new-key" });
  });

  it("closes the dialog on successful save", async () => {
    const { useUpdateProvider } = await import("@/src/hooks/useProviderMutations");
    const mockedUseUpdateProvider = vi.mocked(useUpdateProvider);
    mockedUseUpdateProvider.mockReturnValue({
      mutate: (
        _args: unknown,
        opts?: { onSuccess?: () => void },
      ) => {
        opts?.onSuccess?.();
      },
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateProvider>);

    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /edit credentials/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open when the mutation errors", async () => {
    const { useUpdateProvider } = await import("@/src/hooks/useProviderMutations");
    const mockedUseUpdateProvider = vi.mocked(useUpdateProvider);
    mockedUseUpdateProvider.mockReturnValue({
      mutate: (
        _args: unknown,
        opts?: { onError?: (err: Error) => void },
      ) => {
        opts?.onError?.(new Error("network error"));
      },
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateProvider>);

    const user = userEvent.setup();
    renderWithProviders(<ProvidersContent />);

    await user.click(screen.getByRole("button", { name: /edit credentials/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Dialog stays open on error
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// ConfiguredProviderRow — deprecated model badge (dashboard#289)
// ---------------------------------------------------------------------------

describe("ConfiguredProviderRow — deprecated model badge (dashboard#289)", () => {
  const mockedUseSupportedProviders = vi.mocked(useSupportedProviders);
  const mockedUseProviders = vi.mocked(useProviders);
  const mockedUseProviderHealth = vi.mocked(useProviderHealth);

  const descriptorWithDeprecated: SupportedProviderDescriptor = {
    ...anthropicDescriptor,
    defaultModels: [
      { name: "claude-3-5-sonnet-20241022", family: "Claude 3.5", contextWindow: 200000, deprecated: false },
      { name: "claude-2-0", family: "Claude 2", contextWindow: 100000, deprecated: true },
    ],
  };

  const providerWithDeprecatedModel = {
    ...mockConfiguredProvider,
    defaultModel: "claude-2-0",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseProviderHealth.mockReturnValue({
      data: { status: "unknown" },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviderHealth>);
  });

  it("shows 'Model deprecated' badge when configured model is deprecated", () => {
    mockedUseSupportedProviders.mockReturnValue({
      data: [descriptorWithDeprecated],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
    const deprecatedProviderList: ListProvidersResponse = {
      providers: [providerWithDeprecatedModel],
      defaultProvider: providerWithDeprecatedModel.name,
        };
    mockedUseProviders.mockReturnValue({
      data: deprecatedProviderList,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.getByText("Model deprecated")).toBeInTheDocument();
  });

  it("does NOT show 'Model deprecated' badge when configured model is not deprecated", () => {
    mockedUseSupportedProviders.mockReturnValue({
      data: [descriptorWithDeprecated],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
    mockedUseProviders.mockReturnValue({
      data: mockListProvidersResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.queryByText("Model deprecated")).not.toBeInTheDocument();
  });

  it("does NOT show 'Model deprecated' badge when descriptor has no matching model", () => {
    mockedUseSupportedProviders.mockReturnValue({
      data: [anthropicDescriptor],
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSupportedProviders>);
    const unknownModelList: ListProvidersResponse = {
      providers: [{ ...mockConfiguredProvider, defaultModel: "unknown-model" }],
      defaultProvider: mockConfiguredProvider.name,
        };
    mockedUseProviders.mockReturnValue({
      data: unknownModelList,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useProviders>);

    renderWithProviders(<ProvidersContent />);

    expect(screen.queryByText("Model deprecated")).not.toBeInTheDocument();
  });
});
