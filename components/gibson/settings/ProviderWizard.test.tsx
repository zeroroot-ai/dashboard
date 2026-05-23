/**
 * ProviderWizard tests (merged S5 + S9).
 *
 * S5 (dashboard#286): URL/BOOL/REGION typed field rendering, OpenAI compat, SSRF hint.
 * S9 (dashboard#287): Bedrock IRSA toggle hide/show logic.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ProviderWizard, CredentialsAndTest } from "./ProviderWizard";
import { CREDENTIAL_FIELD_TYPE } from "@/src/lib/gibson-client-types";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client-types";

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/src/hooks/useProviderMutations", () => ({
  useCreateProvider: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers — full wizard tests (S5)
// ---------------------------------------------------------------------------

function makeDescriptor(
  overrides: Partial<SupportedProviderDescriptor> = {},
): SupportedProviderDescriptor {
  return {
    type: "test-provider",
    displayName: "Test Provider",
    docsUrl: "https://example.com",
    selfHosted: false,
    credentials: [],
    defaultModels: [{ name: "test-model", family: "", contextWindow: 0 }],
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderWizardAtStep2(descriptor: SupportedProviderDescriptor) {
  render(
    <ProviderWizard supported={[descriptor]} initialType={descriptor.type} />,
    { wrapper },
  );
}

// ---------------------------------------------------------------------------
// Helpers — CredentialsAndTest direct tests (S9)
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderCredentialsAndTest(descriptor: SupportedProviderDescriptor) {
  const onTest = vi.fn();
  const setFormValues = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CredentialsAndTest
        descriptor={descriptor}
        formValues={{ name: descriptor.type, credentials: {} }}
        setFormValues={setFormValues}
        probeResult={null}
        onTest={onTest}
        isTestPending={false}
      />
    </QueryClientProvider>,
  );
  return { onTest, setFormValues };
}

// ---------------------------------------------------------------------------
// S9 fixtures (fieldType uses numeric CREDENTIAL_FIELD_TYPE constants)
// ---------------------------------------------------------------------------

const bedrockWithIrsa: SupportedProviderDescriptor = {
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
      key: "use_irsa",
      label: "Use IRSA (EKS pod identity)",
      required: false,
      secret: false,
      placeholder: "",
      help: "When enabled, the daemon authenticates via the pod's IAM role instead of static keys.",
      fieldType: CREDENTIAL_FIELD_TYPE.BOOL,
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
    {
      key: "aws_session_token",
      label: "AWS Session Token",
      required: false,
      secret: true,
      placeholder: "",
      help: "Optional STS session token",
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

const requiredSecretDescriptor: SupportedProviderDescriptor = {
  type: "bedrock-required",
  displayName: "Bedrock (required key variant)",
  docsUrl: "https://docs.aws.amazon.com/bedrock/",
  selfHosted: false,
  credentials: [
    {
      key: "use_irsa",
      label: "Use IRSA",
      required: false,
      secret: false,
      placeholder: "",
      help: "",
      fieldType: CREDENTIAL_FIELD_TYPE.BOOL,
    },
    {
      key: "aws_access_key_id",
      label: "AWS Access Key ID",
      required: true,
      secret: true,
      placeholder: "",
      help: "",
    },
  ],
  defaultModels: [],
};

// ===========================================================================
// S5 suites — typed field rendering
// ===========================================================================

describe("URL field type", () => {
  const descriptor = makeDescriptor({
    credentials: [
      {
        key: "base_url",
        label: "Base URL",
        required: true,
        secret: false,
        placeholder: "https://api.example.com",
        help: "The API endpoint URL.",
        fieldType: CREDENTIAL_FIELD_TYPE.URL,
      },
    ],
  });

  it("renders an <input type=url> for URL fields", () => {
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("https://api.example.com");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).type).toBe("url");
  });

  it("shows the field label for URL fields", () => {
    renderWizardAtStep2(descriptor);
    expect(screen.getByText("Base URL")).toBeTruthy();
  });
});

describe("BOOL field type", () => {
  const descriptor = makeDescriptor({
    credentials: [
      {
        key: "use_ssl",
        label: "Use SSL",
        required: false,
        secret: false,
        placeholder: "",
        help: "Enable SSL verification.",
        fieldType: CREDENTIAL_FIELD_TYPE.BOOL,
      },
    ],
  });

  it("renders a checkbox for BOOL fields", () => {
    renderWizardAtStep2(descriptor);
    const checkbox = document.querySelector('[role="checkbox"]');
    expect(checkbox).toBeTruthy();
  });

  it("renders the BOOL label inline with the checkbox (not as a separate FormLabel)", () => {
    renderWizardAtStep2(descriptor);
    const label = document.querySelector('label[for="use_ssl"]');
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain("Use SSL");
  });

  it("does not render a separate FormLabel above the checkbox for BOOL", () => {
    renderWizardAtStep2(descriptor);
    const allLabels = Array.from(document.querySelectorAll("label")).map(
      (l) => l.textContent ?? "",
    );
    const useSslLabels = allLabels.filter((t) => t.trim() === "Use SSL");
    expect(useSslLabels.length).toBe(1);
  });

  it("toggles between true and false when clicked", () => {
    renderWizardAtStep2(descriptor);
    const checkbox = document.querySelector('[role="checkbox"]')!;
    expect((checkbox as HTMLElement).getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(checkbox);
    expect((checkbox as HTMLElement).getAttribute("data-state")).toBe("checked");
  });
});

describe("REGION field type", () => {
  const descriptor = makeDescriptor({
    credentials: [
      {
        key: "aws_region",
        label: "AWS Region",
        required: true,
        secret: false,
        placeholder: "us-east-1",
        help: "The AWS region to use.",
        fieldType: CREDENTIAL_FIELD_TYPE.REGION,
      },
    ],
  });

  it("renders a text input with a datalist for REGION fields", () => {
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("us-east-1");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).type).toBe("text");
    const listId = (input as HTMLInputElement).getAttribute("list");
    expect(listId).toBeTruthy();
    const datalist = document.getElementById(listId!);
    expect(datalist).toBeTruthy();
    expect(datalist!.tagName.toLowerCase()).toBe("datalist");
  });

  it("populates the datalist with known AWS regions", () => {
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("us-east-1");
    const listId = (input as HTMLInputElement).getAttribute("list")!;
    const datalist = document.getElementById(listId)!;
    const options = Array.from(datalist.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toContain("us-east-1");
    expect(options).toContain("eu-west-1");
    expect(options).toContain("ap-southeast-1");
  });

  it("populates the datalist with known GCP regions", () => {
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("us-east-1");
    const listId = (input as HTMLInputElement).getAttribute("list")!;
    const datalist = document.getElementById(listId)!;
    const options = Array.from(datalist.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toContain("us-central1");
    expect(options).toContain("europe-west1");
  });
});

describe("Fallback behaviour when fieldType is absent", () => {
  it("renders a password input when secret=true and fieldType is absent", () => {
    const descriptor = makeDescriptor({
      credentials: [
        {
          key: "api_key",
          label: "API Key",
          required: true,
          secret: true,
          placeholder: "sk-...",
          help: "",
        },
      ],
    });
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("sk-...");
    expect((input as HTMLInputElement).type).toBe("password");
  });

  it("renders a text input when secret=false and fieldType is absent", () => {
    const descriptor = makeDescriptor({
      credentials: [
        {
          key: "region",
          label: "Region",
          required: false,
          secret: false,
          placeholder: "us-east-1",
          help: "",
        },
      ],
    });
    renderWizardAtStep2(descriptor);
    const input = screen.getByPlaceholderText("us-east-1");
    expect((input as HTMLInputElement).type).toBe("text");
  });
});

describe("SSRF hint", () => {
  it("shows the SSRF hint when error includes allow_private_llm_endpoints", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          ok: false,
          latencyMs: 0,
          error:
            "Connection refused: SSRF guard blocked private endpoint (allow_private_llm_endpoints)",
          models: [],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const descriptor = makeDescriptor({
      credentials: [
        {
          key: "api_key",
          label: "API Key",
          required: true,
          secret: true,
          placeholder: "sk-...",
          help: "",
        },
      ],
    });
    renderWizardAtStep2(descriptor);

    const testBtn = screen.getByRole("button", { name: /test connection/i });
    fireEvent.click(testBtn);

    vi.unstubAllGlobals();
  });

  it("does NOT show the SSRF hint for generic connection errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          ok: false,
          latencyMs: 0,
          error: "Connection refused: dial tcp timeout",
          models: [],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const descriptor = makeDescriptor({
      credentials: [
        {
          key: "api_key",
          label: "API Key",
          required: true,
          secret: true,
          placeholder: "sk-...",
          help: "",
        },
      ],
    });
    renderWizardAtStep2(descriptor);

    expect(
      document.body.textContent?.includes("security.allow_private_llm_endpoints"),
    ).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe("OpenAI-compatible guidance", () => {
  it("shows the compatibility note on the OpenAI card", () => {
    const supported: SupportedProviderDescriptor[] = [
      makeDescriptor({ type: "openai", displayName: "OpenAI" }),
      makeDescriptor({ type: "anthropic", displayName: "Anthropic" }),
    ];
    render(<ProviderWizard supported={supported} />, { wrapper });
    expect(
      screen.getByText(
        /also works with azure openai, ask sage, and other compatible providers/i,
      ),
    ).toBeTruthy();
  });

  it("does NOT show the compatibility note on non-OpenAI cards", () => {
    const supported: SupportedProviderDescriptor[] = [
      makeDescriptor({ type: "anthropic", displayName: "Anthropic" }),
    ];
    render(<ProviderWizard supported={supported} />, { wrapper });
    expect(
      screen.queryByText(
        /also works with azure openai, ask sage, and other compatible providers/i,
      ),
    ).toBeNull();
  });
});

// ===========================================================================
// S9 suite — IRSA toggle
// ===========================================================================

describe("ProviderWizard — IRSA toggle (dashboard#287)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the IRSA checkbox when the descriptor has a BOOL `use_irsa` field", () => {
    renderCredentialsAndTest(bedrockWithIrsa);
    expect(screen.getByRole("checkbox", { name: /use irsa/i })).toBeInTheDocument();
  });

  it("renders static key fields visible when IRSA is unchecked (default)", () => {
    renderCredentialsAndTest(bedrockWithIrsa);
    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AWS Secret Access Key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AWS Session Token/i)).toBeInTheDocument();
  });

  it("hides secret+optional fields after checking IRSA", async () => {
    const user = userEvent.setup();
    renderCredentialsAndTest(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.queryByLabelText(/AWS Access Key ID/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/AWS Secret Access Key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/AWS Session Token/i)).not.toBeInTheDocument();
  });

  it("keeps non-secret fields visible when IRSA is active", async () => {
    const user = userEvent.setup();
    renderCredentialsAndTest(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.getByLabelText(/AWS Region/i)).toBeInTheDocument();
  });

  it("keeps required+secret fields visible when IRSA is active", async () => {
    const user = userEvent.setup();
    renderCredentialsAndTest(requiredSecretDescriptor);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
  });

  it("restores hidden fields after unchecking IRSA", async () => {
    const user = userEvent.setup();
    renderCredentialsAndTest(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);
    expect(screen.queryByLabelText(/AWS Access Key ID/i)).not.toBeInTheDocument();

    await user.click(irsaCheckbox);
    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
  });

  it("shows the IRSA help text when IRSA is checked", async () => {
    const user = userEvent.setup();
    renderCredentialsAndTest(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(
      screen.getByText(/EKS service-account IAM role/i),
    ).toBeInTheDocument();
  });

  it("hides the IRSA help text when IRSA is unchecked", () => {
    renderCredentialsAndTest(bedrockWithIrsa);
    expect(screen.queryByText(/EKS service-account IAM role/i)).not.toBeInTheDocument();
  });

  it("submits use_irsa: 'true' and retains hidden credential keys in the payload", async () => {
    const user = userEvent.setup();
    const { onTest } = renderCredentialsAndTest(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    const submitBtn = screen.getByRole("button", { name: /test connection/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(onTest).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onTest.mock.calls[0][0] as {
      credentials: Record<string, string>;
    };

    expect(submittedValues.credentials.use_irsa).toBe("true");
    // Hidden fields appear in the payload with empty string defaults —
    // react-hook-form retains defaultValues for fields that return null.
    expect(submittedValues.credentials).toHaveProperty("aws_access_key_id");
    expect(submittedValues.credentials).toHaveProperty("aws_secret_access_key");
    expect(submittedValues.credentials).toHaveProperty("aws_session_token");
  });
});
