// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * ProviderWizard tests.
 *
 * S5 (dashboard#286): URL/BOOL/REGION typed field rendering, OpenAI compat.
 * S9 (dashboard#287): Bedrock IRSA toggle hide/show logic.
 * dashboard#374 (gibson#1394): the wizard saves first and tests after. Only a
 * type that the gateway routes is offered. The name is a Kubernetes name. A
 * chat model needs a stated context window.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ProviderWizard, CredentialsForm } from "./ProviderWizard";
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

const { createMutate, createState } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  createState: { isPending: false },
}));

vi.mock("@/src/hooks/useProviderMutations", () => ({
  useCreateProvider: () => ({ mutate: createMutate, isPending: createState.isPending }),
  useDeleteProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The test panel has its own tests. Here it only shows that step 3 started.
vi.mock("./ProviderTestPanel", () => ({
  ProviderTestPanel: ({ name }: { name: string }) => <div data-testid="test-panel">{name}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers, full wizard tests (S5)
// ---------------------------------------------------------------------------

function makeDescriptor(
  overrides: Partial<SupportedProviderDescriptor> = {},
): SupportedProviderDescriptor {
  return {
    type: "anthropic",
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
// Helpers, CredentialsForm direct tests (S9)
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderCredentialsForm(descriptor: SupportedProviderDescriptor) {
  const setFormValues = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CredentialsForm
        descriptor={descriptor}
        formValues={{ name: descriptor.type, credentials: {} }}
        setFormValues={setFormValues}
      />
    </QueryClientProvider>,
  );
  return { setFormValues };
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
      family: "Bedrock, Claude 3",
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
// S5 suites, typed field rendering
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

describe("Fallback behavior when fieldType is absent", () => {
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
// S9 suite, IRSA toggle
// ===========================================================================

describe("ProviderWizard, IRSA toggle (dashboard#287)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the IRSA checkbox when the descriptor has a BOOL `use_irsa` field", () => {
    renderCredentialsForm(bedrockWithIrsa);
    expect(screen.getByRole("checkbox", { name: /use irsa/i })).toBeInTheDocument();
  });

  it("renders static key fields visible when IRSA is unchecked (default)", () => {
    renderCredentialsForm(bedrockWithIrsa);
    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AWS Secret Access Key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AWS Session Token/i)).toBeInTheDocument();
  });

  it("hides secret+optional fields after checking IRSA", async () => {
    const user = userEvent.setup();
    renderCredentialsForm(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.queryByLabelText(/AWS Access Key ID/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/AWS Secret Access Key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/AWS Session Token/i)).not.toBeInTheDocument();
  });

  it("keeps non-secret fields visible when IRSA is active", async () => {
    const user = userEvent.setup();
    renderCredentialsForm(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.getByLabelText(/AWS Region/i)).toBeInTheDocument();
  });

  it("keeps required+secret fields visible when IRSA is active", async () => {
    const user = userEvent.setup();
    renderCredentialsForm(requiredSecretDescriptor);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
  });

  it("restores hidden fields after unchecking IRSA", async () => {
    const user = userEvent.setup();
    renderCredentialsForm(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);
    expect(screen.queryByLabelText(/AWS Access Key ID/i)).not.toBeInTheDocument();

    await user.click(irsaCheckbox);
    expect(screen.getByLabelText(/AWS Access Key ID/i)).toBeInTheDocument();
  });

  it("shows the IRSA help text when IRSA is checked", async () => {
    const user = userEvent.setup();
    renderCredentialsForm(bedrockWithIrsa);

    const irsaCheckbox = screen.getByRole("checkbox", { name: /use irsa/i });
    await user.click(irsaCheckbox);

    expect(
      screen.getByText(/EKS service-account IAM role/i),
    ).toBeInTheDocument();
  });

  it("hides the IRSA help text when IRSA is unchecked", () => {
    renderCredentialsForm(bedrockWithIrsa);
    expect(screen.queryByText(/EKS service-account IAM role/i)).not.toBeInTheDocument();
  });

  it("reports use_irsa: 'true' and keeps hidden credential keys in the values", async () => {
    const user = userEvent.setup();
    const { setFormValues } = renderCredentialsForm(bedrockWithIrsa);

    await user.click(screen.getByRole("checkbox", { name: /use irsa/i }));

    await waitFor(() => expect(setFormValues).toHaveBeenCalled());
    const last = setFormValues.mock.calls.at(-1)![0] as { credentials: Record<string, string> };
    expect(last.credentials.use_irsa).toBe("true");
    // Hidden fields stay in the values with empty defaults.
    expect(last.credentials).toHaveProperty("aws_access_key_id");
    expect(last.credentials).toHaveProperty("aws_secret_access_key");
    expect(last.credentials).toHaveProperty("aws_session_token");
  });
});

// ===========================================================================
// Fixtures for the wizard flow
// ===========================================================================

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
  ],
};


const openaiWithEmbeddingsDescriptor: SupportedProviderDescriptor = {
  type: "openai",
  displayName: "OpenAI",
  docsUrl: "https://platform.openai.com/",
  selfHosted: false,
  credentials: [
    {
      key: "api_key",
      label: "OpenAI API Key",
      required: true,
      secret: true,
      placeholder: "sk-...",
      help: "",
    },
  ],
  defaultModels: [
    { name: "gpt-4o", family: "GPT-4o", contextWindow: 128000 },
  ],
  embeddingModels: [
    { name: "text-embedding-3-small", family: "", contextWindow: 0 },
    { name: "text-embedding-3-large", family: "", contextWindow: 0 },
    { name: "text-embedding-ada-002", family: "", contextWindow: 0 },
  ],
};

// ===========================================================================
// Login shapes for bank members (gibson#1706 lane E6): Vertex and Foundry
// ===========================================================================

const vertexDescriptor: SupportedProviderDescriptor = {
  type: "vertex",
  displayName: "Google Vertex (Claude)",
  docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude",
  selfHosted: false,
  credentials: [
    { key: "vertex_project_id", label: "Google Cloud Project ID", required: true, secret: false, placeholder: "", help: "" },
    { key: "vertex_region", label: "Vertex Region", required: true, secret: false, placeholder: "us-east5", help: "" },
    {
      key: "google_application_credentials_json",
      label: "Service Account JSON",
      required: true,
      secret: true,
      placeholder: "",
      help: "The whole service-account key document.",
    },
  ],
  defaultModels: [{ name: "claude-sonnet-4-5@20250929", family: "Claude", contextWindow: 200000 }],
};

const foundryDescriptor: SupportedProviderDescriptor = {
  type: "foundry",
  displayName: "Microsoft Foundry (Claude)",
  docsUrl: "https://learn.microsoft.com/azure/ai-foundry/",
  selfHosted: false,
  credentials: [
    { key: "foundry_api_key", label: "Foundry API Key", required: true, secret: true, placeholder: "", help: "" },
    { key: "foundry_resource", label: "Foundry Resource Name", required: true, secret: false, placeholder: "", help: "" },
  ],
  defaultModels: [],
};

describe("Vertex login shape: the service-account document", () => {
  it("renders the JSON document as a multi-line box, not a one-line input", () => {
    renderCredentialsForm(vertexDescriptor);
    const box = screen.getByTestId("secret-document-google_application_credentials_json");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("spellcheck", "false");
    // The project id and region stay plain text inputs.
    expect(screen.getByLabelText(/Google Cloud Project ID/)).toHaveAttribute("type", "text");
    expect(screen.getByLabelText(/Vertex Region/)).toHaveAttribute("type", "text");
  });

  it("refuses a truncated document with a message", async () => {
    renderCredentialsForm(vertexDescriptor);
    const box = screen.getByTestId("secret-document-google_application_credentials_json");
    fireEvent.change(box, { target: { value: '{"type":"service_account"' } });
    expect(await screen.findByText(/Paste the whole JSON document/)).toBeInTheDocument();
  });

  it("reports a whole document as the raw text", async () => {
    const { setFormValues } = renderCredentialsForm(vertexDescriptor);
    const doc = '{"type":"service_account","project_id":"proj","private_key":"-----BEGIN-----"}';
    const box = screen.getByTestId("secret-document-google_application_credentials_json");
    fireEvent.change(box, { target: { value: doc } });
    await waitFor(() => expect(setFormValues).toHaveBeenCalled());
    const last = setFormValues.mock.calls.at(-1)![0] as { credentials: Record<string, string> };
    expect(last.credentials.google_application_credentials_json).toBe(doc);
  });

  it("leaves the document blank in edit mode so the stored value is kept", () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CredentialsForm
          descriptor={vertexDescriptor}
          providerName="vertex-prod"
          secretFieldPlaceholder="Leave blank to keep existing value"
          initialValues={{ vertex_project_id: "proj", vertex_region: "us-east5" }}
        />
      </QueryClientProvider>,
    );
    const box = screen.getByTestId("secret-document-google_application_credentials_json");
    expect(box).toHaveValue("");
    expect(box).toHaveAttribute("placeholder", "Leave blank to keep existing value");
    expect(screen.getByLabelText(/Google Cloud Project ID/)).toHaveValue("proj");
  });
});

describe("Foundry login shape", () => {
  it("masks the API key and shows the resource name as text", () => {
    renderCredentialsForm(foundryDescriptor);
    expect(screen.getByLabelText(/Foundry API Key/)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/Foundry Resource Name/)).toHaveAttribute("type", "text");
  });
});

describe("Provider picker: login-shape hint", () => {
  it("says which configurations bank members can run on, and stays silent for the rest", () => {
    const openai = makeDescriptor({ type: "openai", displayName: "OpenAI" });
    render(<ProviderWizard supported={[vertexDescriptor, bedrockWithIrsa, openai]} />, { wrapper });
    expect(screen.getByTestId("login-shape-hint-vertex")).toHaveTextContent("Google Vertex AI");
    expect(screen.getByTestId("login-shape-hint-bedrock")).toHaveTextContent("Amazon Bedrock");
    expect(screen.queryByTestId("login-shape-hint-openai")).toBeNull();
  });
});

describe("Provider picker: only the types that the gateway routes (gibson#1394)", () => {
  const all = [
    "anthropic",
    "openai",
    "openai-compatible",
    "bedrock",
    "google",
    "vertex",
    "voyage",
    "cloudflare",
    "cohere",
    "huggingface",
    "llamafile",
    "mistral",
    "foundry",
    "ollama",
    "custom",
    "tei",
  ];

  it("offers the six routed types and none of the others, and never Voyage", () => {
    render(
      <ProviderWizard
        supported={all.map((t) => makeDescriptor({ type: t, displayName: `Name ${t}` }))}
      />,
      { wrapper },
    );
    for (const t of ["anthropic", "openai", "openai-compatible", "bedrock", "google", "vertex"]) {
      expect(screen.getByText(`Name ${t}`)).toBeInTheDocument();
    }
    for (const t of all.slice(6)) {
      expect(screen.queryByText(`Name ${t}`)).toBeNull();
    }
    expect(screen.queryByText(/voyage/i)).toBeNull();
  });

  it("does not start at step 2 for a type that is not offered", () => {
    render(
      <ProviderWizard
        supported={[makeDescriptor({ type: "voyage", displayName: "Voyage AI" })]}
        initialType="voyage"
      />,
      { wrapper },
    );
    expect(screen.queryByText("Voyage AI")).toBeNull();
  });
});

describe("ProviderWizard: save first, test after (gibson#1394)", () => {
  beforeEach(() => {
    createMutate.mockReset();
    createState.isPending = false;
  });

  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "claude-prod");
    await user.type(screen.getByPlaceholderText("sk-ant-..."), "sk-ant-test-key");
    await user.type(screen.getByLabelText("Default chat model"), "claude-sonnet-4-5");
    await user.type(screen.getByLabelText(/context window/i), "200000");
  }

  function renderAnthropic(props: { preselectDefault?: boolean } = {}) {
    const user = userEvent.setup();
    render(<ProviderWizard supported={[anthropicDescriptor]} initialType="anthropic" {...props} />, {
      wrapper,
    });
    return user;
  }

  it("has no Test connection button before the save", () => {
    renderAnthropic();
    expect(screen.queryByRole("button", { name: /test connection/i })).toBeNull();
    expect(screen.getByRole("button", { name: /save provider/i })).toBeInTheDocument();
  });

  it("sends the credentials only in CreateProvider, with the stated context window", async () => {
    const user = renderAnthropic();
    await fillValid(user);
    const save = screen.getByRole("button", { name: /save provider/i });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(createMutate).toHaveBeenCalledTimes(1);
    const config = createMutate.mock.calls[0][0].config;
    expect(config).toMatchObject({
      type: "anthropic",
      name: "claude-prod",
      defaultModel: "claude-sonnet-4-5",
      credentials: { api_key: "sk-ant-test-key" },
      defaultModelContextWindow: 200000,
    });
  });

  it("calls no test endpoint from the form", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = renderAnthropic();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save provider/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("starts the test step with the saved name after a good save", async () => {
    createMutate.mockImplementation((_vars, opts: { onSuccess: () => void }) => opts.onSuccess());
    const user = renderAnthropic();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save provider/i }));
    expect(await screen.findByTestId("test-panel")).toHaveTextContent("claude-prod");
  });

  it("stays on the form after a refused save, with the input kept", async () => {
    createMutate.mockImplementation((_vars, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error("name already exists")),
    );
    const user = renderAnthropic();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save provider/i }));
    expect(screen.queryByTestId("test-panel")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue("claude-prod");
  });

  it("needs the context window of a chat model", async () => {
    const user = renderAnthropic();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "claude-prod");
    await user.type(screen.getByPlaceholderText("sk-ant-..."), "k");
    await user.type(screen.getByLabelText("Default chat model"), "m");
    const save = screen.getByRole("button", { name: /save provider/i });
    expect(save).toBeDisabled();
    const field = screen.getByLabelText(/context window/i);
    expect(field).toHaveAttribute("type", "number");
    expect(screen.getByText(/Required for a chat model/i)).toBeInTheDocument();
    await user.type(field, "99999999");
    expect(save).toBeDisabled();
    await user.clear(field);
    await user.type(field, "0");
    expect(save).toBeDisabled();
    await user.clear(field);
    await user.type(field, "128000");
    expect(save).toBeEnabled();
  });

  it.each([
    ["Claude", "Use lowercase"],
    ["claude_prod", "Use lowercase"],
    ["-claude", "Start and end"],
    ["claude-", "Start and end"],
    ["x".repeat(64), "at most 63"],
  ])("refuses the name %j and keeps Save disabled", async (name, hint) => {
    const user = renderAnthropic();
    await user.type(screen.getByPlaceholderText("sk-ant-..."), "k");
    await user.type(screen.getByLabelText("Default chat model"), "m");
    await user.type(screen.getByLabelText(/context window/i), "1000");
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    // maxLength stops a long name in the browser, so set it as a change event.
    fireEvent.change(nameField, { target: { value: name } });
    expect(await screen.findByTestId("save-blocked")).toHaveTextContent(new RegExp(hint));
    expect(screen.getByRole("button", { name: /save provider/i })).toBeDisabled();
  });

  it("keeps Save disabled until the required credential is filled", async () => {
    const user = renderAnthropic();
    await user.type(screen.getByLabelText("Default chat model"), "m");
    await user.type(screen.getByLabelText(/context window/i), "1000");
    expect(screen.getByRole("button", { name: /save provider/i })).toBeDisabled();
    expect(screen.getByTestId("save-blocked")).toHaveTextContent(/Anthropic API Key is required/);
  });

  it("checks 'set as default' only when asked, and sends it", async () => {
    const user = renderAnthropic({ preselectDefault: true });
    expect(screen.getByRole("checkbox", { name: /set as default provider/i })).toBeChecked();
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: /save provider/i }));
    expect(createMutate.mock.calls[0][0].config.setAsDefault).toBe(true);
  });

  it("leaves 'set as default' unchecked when a default exists", () => {
    renderAnthropic({ preselectDefault: false });
    expect(screen.getByRole("checkbox", { name: /set as default provider/i })).not.toBeChecked();
  });
});
