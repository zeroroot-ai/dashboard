/**
 * Unit tests for app/actions/secrets.ts
 *
 * Mocks the underlying gibson-client sub-module and next/cache so the tests
 * run without a live gRPC connection or Next.js runtime.
 *
 * Spec: secrets-tenant-lifecycle Task 7.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, must precede subject import.
// vi.hoisted() lifts declarations above the hoisted vi.mock() factory calls.
// ---------------------------------------------------------------------------

const {
  mockSetSecret,
  mockRotateSecret,
  mockDeleteSecret,
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
  return {
    mockSetSecret: vi.fn(),
    mockRotateSecret: vi.fn(),
    mockDeleteSecret: vi.fn(),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
    MockAuthzDeniedError: _MockAuthzDeniedError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/gibson-client/secrets", () => ({
  setSecret: mockSetSecret,
  rotateSecret: mockRotateSecret,
  deleteSecret: mockDeleteSecret,
}));

vi.mock("@/src/gen/gibson/tenant/v1/secrets_pb", () => ({
  SecretCategory: { UNSPECIFIED: 0, CRED: 1, PROVIDER_CONFIG: 2 },
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

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import {
  createSecretAction,
  rotateSecretAction,
  deleteSecretAction,
} from "../secrets";

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

function makeSecretMeta(name: string) {
  return {
    name,
    category: 1,
    version: BigInt(1),
    createdAtUnix: BigInt(0),
    createdBy: "user-1",
    updatedAtUnix: BigInt(0),
    updatedBy: "user-1",
    lastAccessedAtUnix: BigInt(0),
    pluginAssociations: [],
  };
}

// ---------------------------------------------------------------------------
// createSecretAction
// ---------------------------------------------------------------------------

describe("createSecretAction, success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setSecret with encoded value bytes and returns metadata", async () => {
    const meta = makeSecretMeta("cred:api_key");
    mockSetSecret.mockResolvedValue({ metadata: meta });

    const fd = makeFormData({
      name: "cred:api_key",
      category: "cred",
      value: "s3cr3t",
    });
    const result = await createSecretAction(fd);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toStrictEqual(meta);

    // Verify value was encoded and forwarded.
    const [name, category, valueBytes] = mockSetSecret.mock.calls[0];
    expect(name).toBe("cred:api_key");
    expect(category).toBe(1); // SecretCategory.CRED
    // Cross-realm Uint8Array instanceof check is unreliable in jsdom; check
    // the decoded content instead, same security guarantee.
    expect(Buffer.from(valueBytes).toString("utf8")).toBe("s3cr3t");

    // revalidatePath called.
    expect(revalidatePath).toHaveBeenCalledWith(
      "/dashboard/pages/settings/secrets",
    );
  });
});

describe("createSecretAction, validation errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bad_input when name is empty", async () => {
    const fd = makeFormData({ name: "", category: "cred", value: "x" });
    const result = await createSecretAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  it("returns bad_input when value is empty", async () => {
    const fd = makeFormData({ name: "cred:x", category: "cred", value: "" });
    const result = await createSecretAction(fd);
    expect(result.ok).toBe(false);
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  it("returns bad_input for invalid category", async () => {
    const fd = makeFormData({
      name: "cred:x",
      category: "unknown_cat",
      value: "v",
    });
    const result = await createSecretAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
  });
});

describe("createSecretAction, RPC error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns structured error without value in message", async () => {
    const sentValue = "my-super-secret-value";
    const rpcErr = Object.assign(
      new Error("broker unavailable"),
      { code: "unavailable" },
    );
    mockSetSecret.mockRejectedValue(rpcErr);

    const fd = makeFormData({
      name: "cred:x",
      category: "cred",
      value: sentValue,
    });
    const result = await createSecretAction(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("unavailable");
    // SECURITY: value must not appear in the error message.
    expect(result.error).not.toContain(sentValue);
  });
});

describe("createSecretAction, unauthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetServerSession.mockResolvedValueOnce(null as any);
  });

  it("returns unauthenticated when no session", async () => {
    const fd = makeFormData({ name: "cred:x", category: "cred", value: "v" });
    const result = await createSecretAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("unauthenticated");
    expect(mockSetSecret).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rotateSecretAction
// ---------------------------------------------------------------------------

describe("rotateSecretAction, success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls rotateSecret with encoded value and returns updated metadata", async () => {
    const meta = makeSecretMeta("cred:api_key");
    mockRotateSecret.mockResolvedValue({ metadata: meta });

    const fd = makeFormData({ value: "new-value" });
    const result = await rotateSecretAction("cred:api_key", fd);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toStrictEqual(meta);

    const [name, valueBytes] = mockRotateSecret.mock.calls[0];
    expect(name).toBe("cred:api_key");
    expect(new TextDecoder().decode(valueBytes)).toBe("new-value");

    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe("rotateSecretAction, validation errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bad_input when new value is empty", async () => {
    const fd = makeFormData({ value: "" });
    const result = await rotateSecretAction("cred:api_key", fd);
    expect(result.ok).toBe(false);
    expect(mockRotateSecret).not.toHaveBeenCalled();
  });

  it("returns bad_input for invalid secret name", async () => {
    const fd = makeFormData({ value: "new" });
    const result = await rotateSecretAction("../../../etc/passwd", fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
  });
});

describe("rotateSecretAction, RPC error does not leak value", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error without new value in message", async () => {
    const sentValue = "my-new-secret";
    const rpcErr = Object.assign(new Error("permission denied"), {
      code: "permission_denied",
    });
    mockRotateSecret.mockRejectedValue(rpcErr);

    const fd = makeFormData({ value: sentValue });
    const result = await rotateSecretAction("cred:x", fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.error).not.toContain(sentValue);
  });
});

// ---------------------------------------------------------------------------
// deleteSecretAction
// ---------------------------------------------------------------------------

describe("deleteSecretAction, success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls deleteSecret with the name and revalidates", async () => {
    mockDeleteSecret.mockResolvedValue({});

    const result = await deleteSecretAction("cred:old_key");

    expect(result.ok).toBe(true);
    expect(mockDeleteSecret).toHaveBeenCalledWith("cred:old_key");
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe("deleteSecretAction, validation error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bad_input for empty name", async () => {
    const result = await deleteSecretAction("");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });
});

describe("deleteSecretAction, RPC error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns structured error on RPC failure", async () => {
    const rpcErr = Object.assign(new Error("not found"), { code: "not_found" });
    mockDeleteSecret.mockRejectedValue(rpcErr);

    const result = await deleteSecretAction("cred:gone");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("not_found");
    expect(result.error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Authz denial mapping (dashboard#904)
//
// The per-RPC authz check is baked into the userClient transport
// (dashboard#848 / #902), so a denial surfaces as AuthzDeniedError thrown
// from INSIDE the gibson-client call. Each action must map it to the
// canonical permission_denied result.
// ---------------------------------------------------------------------------

describe("createSecretAction, authz denied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSecret.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.SecretsService/SetSecret",
        "relation-not-met",
      ),
    );
  });

  it("maps the wrapper-thrown denial to permission_denied", async () => {
    const fd = makeFormData({ name: "cred:x", category: "cred", value: "v" });
    const result = await createSecretAction(fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});

describe("rotateSecretAction, authz denied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRotateSecret.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.SecretsService/RotateSecret",
        "relation-not-met",
      ),
    );
  });

  it("maps the wrapper-thrown denial to permission_denied", async () => {
    const fd = makeFormData({ value: "new-v" });
    const result = await rotateSecretAction("cred:x", fd);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});

describe("deleteSecretAction, authz denied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteSecret.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.SecretsService/DeleteSecret",
        "relation-not-met",
      ),
    );
  });

  it("maps the wrapper-thrown denial to permission_denied", async () => {
    const result = await deleteSecretAction("cred:x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});
