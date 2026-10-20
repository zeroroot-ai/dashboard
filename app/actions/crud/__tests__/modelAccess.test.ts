// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for app/actions/crud/modelAccess.ts
 *
 * Focus: defense-in-depth authz mapping (dashboard#864 / #904). The per-RPC
 * authz check is baked into the userClient transport (dashboard#848 / #902),
 * so a denial is thrown from INSIDE the daemon RPC call as AuthzDeniedError.
 * The grant/revoke actions must map that denial to the canonical
 * "Permission denied" result via permissionDeniedResult.
 *
 * Mocks the gibson-client factory and the assert-authorized helper so the
 * tests run without a live gRPC connection. Mirrors app/actions/__tests__/
 * secrets.test.ts.
 *
 * Refs #864 / #818 / #904.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, must precede subject import.
// ---------------------------------------------------------------------------

const {
  mockGrantAccess,
  mockRevokeAccess,
  mockListAccess,
  mockGetModelAccessClient,
  mockGetSupportedProviders,
  mockListProviders,
  mockListProviderModels,
  mockGetServerSession,
  MockAuthzDeniedError,
} = vi.hoisted(() => {
  class _MockAuthzDeniedError extends Error {
    public readonly method: string;
    public readonly reason: string;
    constructor(method: string, reason: string) {
      super(`assertAuthorized: ${reason} for ${method}`);
      this.name = "AuthzDeniedError";
      this.method = method;
      this.reason = reason;
    }
  }
  const grantAccess = vi.fn(async (_req?: unknown) => ({}));
  const revokeAccess = vi.fn(async (_req?: unknown) => ({}));
  const listAccess = vi.fn(async (_req?: unknown) => ({
    grants: [] as unknown[],
    nextPageToken: "",
  }));
  return {
    mockGrantAccess: grantAccess,
    mockRevokeAccess: revokeAccess,
    mockListAccess: listAccess,
    mockGetModelAccessClient: vi.fn(async () => ({
      grantAccess,
      revokeAccess,
      listAccess,
    })),
    // The real shape: GetSupportedProviders never fills default_models
    // (gibson provider.proto), so chat models come from ListProviderModels.
    mockGetSupportedProviders: vi.fn(async () => ({
      providers: [
        { type: "anthropic", defaultModels: [], embeddingModels: [] },
        { type: "voyage", defaultModels: [], embeddingModels: [{ name: "voyage-3" }] },
        // A catalog type that the tenant has no config for.
        { type: "cohere", defaultModels: [], embeddingModels: [] },
        { type: "google", defaultModels: [], embeddingModels: [] },
        {
          type: "openai",
          defaultModels: [],
          embeddingModels: [{ name: "text-embedding-3-large" }],
        },
      ],
    })),
    mockListProviders: vi.fn(async (_req?: unknown) => ({
      providers: [
        { name: "my-openai", type: "openai", enabled: true, defaultModel: "gpt-5-saved" },
        { name: "work-anthropic", type: "anthropic", enabled: true, defaultModel: "" },
        { name: "broken-anthropic", type: "anthropic", enabled: true, defaultModel: "" },
        { name: "off-anthropic", type: "anthropic", enabled: true, defaultModel: "" },
        // A disabled config: its models and its default model are not offered.
        { name: "disabled-anthropic", type: "anthropic", enabled: false, defaultModel: "disabled-default" },
        // The only config of its type is disabled, so the type is not a target.
        { name: "disabled-google", type: "google", enabled: false, defaultModel: "" },
        // An enabled config of a chat type, saved as embedding only.
        { name: "emb-ollama", type: "ollama", enabled: true, defaultModel: "nomic-embed", capabilities: [2] },
        // An enabled config of an embedding-only type.
        { name: "my-voyage", type: "voyage", enabled: true, defaultModel: "" },
      ],
    })),
    mockListProviderModels: vi.fn(async (req: { name: string }, _opts?: unknown) => {
      if (req.name === "broken-anthropic") throw new Error("unavailable");
      if (req.name === "off-anthropic") {
        return { ok: false, models: [{ name: "must-not-appear" }] };
      }
      if (req.name === "emb-ollama") {
        return { ok: true, models: [{ name: "nomic-embed" }, { name: "llama-chat" }] };
      }
      if (req.name === "disabled-anthropic") {
        return { ok: true, models: [{ name: "disabled-only-model" }] };
      }
      return {
        ok: true,
        models:
          req.name === "my-openai"
            ? [
                { name: "gpt-5" },
                // The provider reports an embedding capability for this model.
                { name: "text-embedding-3-large", capabilities: [2] },
              ]
            : [{ name: "claude-opus-4" }],
      };
    }),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
    MockAuthzDeniedError: _MockAuthzDeniedError,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/gibson-client", () => ({
  getModelAccessClient: mockGetModelAccessClient,
  userClient: vi.fn(() => ({
    getSupportedProviders: mockGetSupportedProviders,
    listProviders: mockListProviders,
    listProviderModels: mockListProviderModels,
  })),
}));

vi.mock("@/src/gen/gibson/tenant/v1/provider_pb", () => ({
  ProviderService: {},
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/auth/assert-authorized", () => ({
  AuthzDeniedError: MockAuthzDeniedError,
  permissionDeniedResult: (err: unknown) =>
    err instanceof MockAuthzDeniedError
      ? {
          ok: false as const,
          error: "Permission denied",
          code: "permission_denied" as const,
        }
      : null,
}));

vi.mock("@/src/gen/gibson/tenant/v1/model_access_pb", () => ({
  GrantSubjectKind: { UNSPECIFIED: 0, USER: 1, TEAM: 2, TENANT: 3 },
  GrantTargetKind: { UNSPECIFIED: 0, PROVIDER: 1, MODEL: 2 },
}));

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import {
  grantModelAccessAction,
  listChatModelsForTypeAction,
  listGrantableProviderTypesAction,
  listModelAccessAction,
  revokeModelAccessAction,
  type GrantInput,
} from "../modelAccess";

const validInput: GrantInput = {
  subjectKind: "user",
  subjectId: "user-2",
  targetKind: "provider",
  targetId: "anthropic",
};

// ---------------------------------------------------------------------------
// grantModelAccessAction
// ---------------------------------------------------------------------------

describe("grantModelAccessAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockGrantAccess).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    // The userClient transport throws the denial from inside the RPC call
    // (dashboard#848 / #902); model it on the client method mock.
    mockGrantAccess.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/GrantAccess",
        "relation-not-met",
      ),
    );
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });

  it("keeps the daemon error message for non-authz failures", async () => {
    mockGrantAccess.mockRejectedValueOnce(new Error("daemon exploded"));
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).not.toBe("permission_denied");
    expect(result.error).toBe("daemon exploded");
  });
});

// ---------------------------------------------------------------------------
// revokeModelAccessAction
// ---------------------------------------------------------------------------

describe("revokeModelAccessAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockRevokeAccess).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    mockRevokeAccess.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/RevokeAccess",
        "relation-not-met",
      ),
    );
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});

// ---------------------------------------------------------------------------
// The default tenant grants (dashboard#221)
// ---------------------------------------------------------------------------

describe("the tenant subject needs no id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists with subject kind TENANT and an empty subject id", async () => {
    mockListAccess.mockResolvedValueOnce({
      grants: [
        {
          tenantId: "tenant-abc",
          subjectKind: 3,
          subjectId: "",
          targetKind: 1,
          targetId: "anthropic",
          grantedAtUnix: BigInt(0),
          grantedByUserId: "",
        },
      ],
      nextPageToken: "",
    });
    const result = await listModelAccessAction("tenant", "");
    expect(mockListAccess).toHaveBeenCalledWith({ subjectKind: 3, subjectId: "", pageSize: 1000, pageToken: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual([
      expect.objectContaining({ subjectKind: "tenant", subjectId: "", targetKind: "provider", targetId: "anthropic" }),
    ]);
  });

  it("drops a typed id for the tenant subject, so the caller's own tenant is used", async () => {
    await listModelAccessAction("tenant", "other-tenant");
    expect(mockListAccess).toHaveBeenCalledWith({ subjectKind: 3, subjectId: "", pageSize: 1000, pageToken: "" });
  });

  it("revokes the default grant of a provider with an empty subject id", async () => {
    const result = await revokeModelAccessAction({
      subjectKind: "tenant",
      subjectId: "",
      targetKind: "provider",
      targetId: "anthropic",
    });
    expect(result.ok).toBe(true);
    expect(mockRevokeAccess).toHaveBeenCalledWith({
      subjectKind: 3,
      subjectId: "",
      targetKind: 1,
      targetId: "anthropic",
    });
  });

  it("keeps the id of a user subject", async () => {
    await listModelAccessAction("user", "user-2");
    expect(mockListAccess).toHaveBeenCalledWith({ subjectKind: 1, subjectId: "user-2", pageSize: 1000, pageToken: "" });
  });
});

describe("grant target comes from the enabled provider configs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a provider type name that is in the catalog", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetId: "openai",
    });
    expect(result.ok).toBe(true);
    expect(mockGrantAccess).toHaveBeenCalledOnce();
    const req = mockGrantAccess.mock.calls[0][0] as { grant: { targetId: string } };
    expect(req.grant.targetId).toBe("openai");
  });

  it("does not send a catalog type that the tenant has no config for", async () => {
    const result = await grantModelAccessAction({ ...validInput, targetId: "cohere" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("invalid_target");
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send a type whose only config is disabled", async () => {
    const result = await grantModelAccessAction({ ...validInput, targetId: "google" });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("offers only the types of enabled, chat-capable configs", async () => {
    const result = await listGrantableProviderTypesAction();
    expect(result).toEqual({ ok: true, data: ["anthropic", "openai"] });
  });

  it("does not offer a config of a chat type that is saved as embedding only", async () => {
    const types = await listGrantableProviderTypesAction();
    expect(types).toEqual({ ok: true, data: ["anthropic", "openai"] });

    const models = await listChatModelsForTypeAction("ollama");
    expect(models).toEqual({ ok: true, data: [] });
    expect(mockListProviderModels).not.toHaveBeenCalledWith(
      { name: "emb-ollama" },
      expect.anything(),
    );

    const provider = await grantModelAccessAction({ ...validInput, targetId: "ollama" });
    expect(provider.ok).toBe(false);
    for (const targetId of ["nomic-embed", "llama-chat"]) {
      const model = await grantModelAccessAction({
        ...validInput,
        targetKind: "model",
        targetId,
        providerType: "ollama",
      });
      expect(model.ok).toBe(false);
    }
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not offer or send the models of a disabled config", async () => {
    const offered = await listChatModelsForTypeAction("anthropic");
    expect(offered).toEqual({ ok: true, data: ["claude-opus-4"] });
    expect(mockListProviderModels).not.toHaveBeenCalledWith(
      { name: "disabled-anthropic" },
      expect.anything(),
    );
    for (const targetId of ["disabled-only-model", "disabled-default"]) {
      const result = await grantModelAccessAction({
        ...validInput,
        targetKind: "model",
        targetId,
        providerType: "anthropic",
      });
      expect(result.ok).toBe(false);
    }
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send an embedding model that an enabled config lists", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "text-embedding-3-large",
      providerType: "openai",
    });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send a tenant provider config name", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetId: "my-openai",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("invalid_target");
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("sends a chat model that ListProviderModels lists for the type", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "gpt-5",
      providerType: "openai",
    });
    expect(result.ok).toBe(true);
    expect(mockListProviderModels).toHaveBeenCalledWith(
      { name: "my-openai" },
      { timeoutMs: 5000 },
    );
    const req = mockGrantAccess.mock.calls[0][0] as { grant: { targetId: string } };
    expect(req.grant.targetId).toBe("gpt-5");
  });

  it("does not send a model that no configured provider of the type lists", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "gpt-4-unlisted",
      providerType: "openai",
    });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send an embedding model, the gate checks chat models", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "text-embedding-3-large",
      providerType: "openai",
    });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("lists the chat models of a type, skipping a config that throws or replies ok:false", async () => {
    const result = await listChatModelsForTypeAction("anthropic");
    expect(result).toEqual({ ok: true, data: ["claude-opus-4"] });
  });

  it("still grants when one config of the type throws", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "claude-opus-4",
      providerType: "anthropic",
    });
    expect(result.ok).toBe(true);
  });

  it("does not take models from an ok:false reply", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "must-not-appear",
      providerType: "anthropic",
    });
    expect(result.ok).toBe(false);
  });

  it("grants the saved default model that the live list no longer returns", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "gpt-5-saved",
      providerType: "openai",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an embedding-only type for a provider grant", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetId: "voyage",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("invalid_target");
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send a model that another provider type lists", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "gpt-5",
      providerType: "anthropic",
    });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("does not send a model grant with no provider type", async () => {
    const result = await grantModelAccessAction({
      ...validInput,
      targetKind: "model",
      targetId: "claude-opus-4",
    });
    expect(result.ok).toBe(false);
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("revoke keeps the listed row target id with no catalog check", async () => {
    const result = await revokeModelAccessAction({
      ...validInput,
      targetId: "my-openai",
    });
    expect(result.ok).toBe(true);
    expect(mockGetSupportedProviders).not.toHaveBeenCalled();
    const req = mockRevokeAccess.mock.calls[0][0] as { targetId: string };
    expect(req.targetId).toBe("my-openai");
  });
});

describe("listModelAccessAction paging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("follows next_page_token and returns the grants of every page", async () => {
    const grant = (id: string) => ({
      tenantId: "t",
      subjectKind: 1,
      subjectId: "user-2",
      targetKind: 1,
      targetId: id,
      grantedAtUnix: BigInt(0),
      grantedByUserId: "",
    });
    mockListAccess
      .mockResolvedValueOnce({ grants: [grant("anthropic")], nextPageToken: "n2" })
      .mockResolvedValueOnce({ grants: [grant("openai")], nextPageToken: "" });

    const result = await listModelAccessAction("user", "user-2");

    if (!result.ok) throw new Error("expected ok");
    expect(result.data.map((g) => g.targetId)).toEqual(["anthropic", "openai"]);
    expect(mockListAccess.mock.calls[1][0]).toMatchObject({ pageToken: "n2" });
  });
});
