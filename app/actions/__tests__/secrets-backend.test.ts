/**
 * Unit tests for app/actions/secrets-backend.ts
 *
 * Spec: secrets-tenant-lifecycle Task 8.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockProbeBrokerConfig, mockSetBrokerConfig, mockGetServerSession } =
  vi.hoisted(() => ({
    mockProbeBrokerConfig: vi.fn(),
    mockSetBrokerConfig: vi.fn(),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
  }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/gibson-client/tenant-broker-config", () => ({
  probeBrokerConfig: mockProbeBrokerConfig,
  setBrokerConfig: mockSetBrokerConfig,
  BrokerProvider: {
    UNSPECIFIED: 0,
    POSTGRES: 1,
    VAULT: 2,
    AWSSM: 3,
    GCPSM: 4,
    AZUREKV: 5,
  },
}));

vi.mock("@/src/gen/gibson/admin/v1/tenant_pb", () => ({
  BrokerProvider: {
    UNSPECIFIED: 0,
    POSTGRES: 1,
    VAULT: 2,
    AWSSM: 3,
    GCPSM: 4,
    AZUREKV: 5,
  },
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import {
  probeBrokerConfigAction,
  setBrokerConfigAction,
} from "../secrets-backend";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

const vaultFormBase = {
  provider: "BROKER_PROVIDER_VAULT",
  address: "https://vault.example.com",
  mount: "secret",
  authMethod: "token",
};

// ---------------------------------------------------------------------------
// probeBrokerConfigAction
// ---------------------------------------------------------------------------

describe("probeBrokerConfigAction — success (probe ok)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok=true with ProbeResult on successful probe", async () => {
    const probeResult = { ok: true, errorClass: "", errorMessage: "", durationMs: BigInt(42) };
    mockProbeBrokerConfig.mockResolvedValue({ result: probeResult });

    const fd = makeFormData({ ...vaultFormBase, vaultToken: "s.abc123" });
    const result = await probeBrokerConfigAction(fd);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toStrictEqual(probeResult);
  });

  it("passes encoded sensitive fields to probeBrokerConfig", async () => {
    mockProbeBrokerConfig.mockResolvedValue({
      result: { ok: true, errorClass: "", errorMessage: "", durationMs: BigInt(10) },
    });

    const fd = makeFormData({ ...vaultFormBase, vaultToken: "my-vault-token" });
    await probeBrokerConfigAction(fd);

    const candidate = mockProbeBrokerConfig.mock.calls[0][0];
    // The sensitive field must be forwarded as bytes (cross-realm Uint8Array
    // instanceof is unreliable in jsdom — check content instead).
    expect(Buffer.from(candidate.vaultToken).toString()).toBe("my-vault-token");
  });
});

describe("probeBrokerConfigAction — probe fails (probe ok=false)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok=true with ProbeResult carrying ok=false on probe failure", async () => {
    const probeResult = {
      ok: false,
      errorClass: "auth_failed",
      errorMessage: "token signature invalid",
      durationMs: BigInt(5),
    };
    mockProbeBrokerConfig.mockResolvedValue({ result: probeResult });

    const fd = makeFormData({ ...vaultFormBase });
    const result = await probeBrokerConfigAction(fd);

    // The action succeeds at transport level; the probe result is returned.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.ok).toBe(false);
    expect(result.data.errorClass).toBe("auth_failed");
  });
});

describe("probeBrokerConfigAction — RPC error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns structured error without sensitive data in message", async () => {
    const rpcErr = Object.assign(new Error("network_unreachable"), {
      code: "unavailable",
    });
    mockProbeBrokerConfig.mockRejectedValue(rpcErr);

    const fd = makeFormData({
      ...vaultFormBase,
      vaultToken: "SUPER_SECRET_TOKEN_MUST_NOT_LEAK",
    });
    const result = await probeBrokerConfigAction(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    // SECURITY: token value must not appear in error.
    expect(result.error).not.toContain("SUPER_SECRET_TOKEN_MUST_NOT_LEAK");
    expect(result.code).toBe("unavailable");
  });
});

describe("probeBrokerConfigAction — bad_input", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bad_input when provider is missing", async () => {
    const fd = makeFormData({ address: "https://vault.example.com" });
    const result = await probeBrokerConfigAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockProbeBrokerConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setBrokerConfigAction
// ---------------------------------------------------------------------------

describe("setBrokerConfigAction — probe-fail aborts save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns probe_failed when SetBrokerConfig returns failed probe_result", async () => {
    const failedProbe = {
      ok: false,
      errorClass: "mount_path_invalid",
      errorMessage: "mount not found at secret/",
      durationMs: BigInt(3),
    };
    mockSetBrokerConfig.mockResolvedValue({
      config: undefined,
      probeResult: failedProbe,
    });

    const fd = makeFormData({ ...vaultFormBase });
    const result = await setBrokerConfigAction(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("probe_failed");
    expect(result.errorClass).toBe("mount_path_invalid");
    // No revalidatePath when probe fails.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setBrokerConfigAction — probe-success-then-save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns saved config and revalidates on success", async () => {
    const savedConfig = {
      provider: 2, // VAULT
      address: "https://vault.example.com",
      sensitiveFieldsSet: ["vault_token"],
      updatedAtUnix: BigInt(0),
      updatedBy: "user-1",
    };
    mockSetBrokerConfig.mockResolvedValue({
      config: savedConfig,
      probeResult: { ok: true, errorClass: "", errorMessage: "", durationMs: BigInt(30) },
    });

    const fd = makeFormData({ ...vaultFormBase, vaultToken: "s.tok" });
    const result = await setBrokerConfigAction(fd);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toStrictEqual(savedConfig);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/dashboard/pages/settings/secrets-backend",
    );
  });
});

describe("setBrokerConfigAction — redacted error messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not include AWS keys in error message", async () => {
    const rpcErr = Object.assign(new Error("connection refused"), {
      code: "unavailable",
    });
    mockSetBrokerConfig.mockRejectedValue(rpcErr);

    const fd = makeFormData({
      provider: "BROKER_PROVIDER_AWSSM",
      region: "us-east-1",
      awsAccessKeyId: "AKIAIOSFODNN7_DO_NOT_LOG",
      awsSecretAccessKey: "wJalrXUtnFEMI_DO_NOT_LOG",
    });
    const result = await setBrokerConfigAction(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.error).not.toContain("AKIAIOSFODNN7_DO_NOT_LOG");
    expect(result.error).not.toContain("wJalrXUtnFEMI_DO_NOT_LOG");
  });
});

describe("setBrokerConfigAction — unauthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetServerSession.mockResolvedValueOnce(null as any);
  });

  it("returns unauthenticated when no session", async () => {
    const fd = makeFormData({ ...vaultFormBase });
    const result = await setBrokerConfigAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("unauthenticated");
    expect(mockSetBrokerConfig).not.toHaveBeenCalled();
  });
});
