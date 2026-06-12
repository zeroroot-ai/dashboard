/**
 * Unit tests for app/actions/plugin-register.ts
 *
 * Spec: secrets-tenant-lifecycle Task 9.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockRegisterPlugin,
  mockGetServerSession,
  mockAssertAuthorized,
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
    mockRegisterPlugin: vi.fn(),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
    mockAssertAuthorized: vi.fn(async () => undefined),
    MockAuthzDeniedError: _MockAuthzDeniedError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/gibson-client/plugins-admin", () => ({
  registerPlugin: mockRegisterPlugin,
}));

vi.mock("@/src/lib/auth/assert-authorized", () => ({
  assertAuthorized: mockAssertAuthorized,
  AuthzDeniedError: MockAuthzDeniedError,
}));

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

import {
  validatePluginManifestAction,
  registerPluginAtomicAction,
} from "../plugin-register";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validManifest = `
apiVersion: gibson.ai/v1
kind: Plugin
metadata:
  name: my-plugin
  version: 0.1.0
spec:
  methods:
    - name: DoThing
  secrets:
    - name: cred:api_key
  runtime:
    mode: process
`.trim();

const validationError = {
  field: "spec.methods[0].name",
  line: 8,
  code: "missing_required",
  message: "method name is required",
};

const successResponse = {
  installId: "install-uuid-1",
  pluginPrincipalId: "zitadel-sa-1",
  bootstrapToken: "bst_abc123",
  bootstrapTokenExpiresAtUnix: BigInt(9999999999),
  validationErrors: [],
};

// ---------------------------------------------------------------------------
// validatePluginManifestAction
// ---------------------------------------------------------------------------

describe("validatePluginManifestAction, validate-success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=true with empty errors on clean manifest", async () => {
    mockRegisterPlugin.mockResolvedValue({ ...successResponse });

    const result = await validatePluginManifestAction(validManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.valid).toBe(true);
    expect(result.data.errors).toHaveLength(0);

    // Must be called with dry_run=true.
    const opts = mockRegisterPlugin.mock.calls[0][0];
    expect(opts.dryRun).toBe(true);
    // No bindings on dry-run.
    expect(opts.bindings).toHaveLength(0);
    // Manifest bytes forwarded.
    expect(Buffer.from(opts.manifestYaml).toString()).toBe(validManifest);
  });
});

describe("validatePluginManifestAction, validate-failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=false with structured errors with line numbers", async () => {
    mockRegisterPlugin.mockResolvedValue({
      ...successResponse,
      validationErrors: [validationError],
    });

    const result = await validatePluginManifestAction(validManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.valid).toBe(false);
    expect(result.data.errors).toHaveLength(1);
    expect(result.data.errors[0]!.line).toBe(8);
    expect(result.data.errors[0]!.code).toBe("missing_required");
  });

  it("returns bad_input for empty manifest", async () => {
    const result = await validatePluginManifestAction("");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });

  it("returns bad_input for manifest exceeding 1 MiB", async () => {
    const huge = "x".repeat(1_048_577);
    const result = await validatePluginManifestAction(huge);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });
});

describe("validatePluginManifestAction, RPC error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns structured error on RPC failure", async () => {
    mockRegisterPlugin.mockRejectedValue(
      Object.assign(new Error("broker not configured"), {
        code: "failed_precondition",
      }),
    );

    const result = await validatePluginManifestAction(validManifest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("failed_precondition");
  });
});

// ---------------------------------------------------------------------------
// registerPluginAtomicAction
// ---------------------------------------------------------------------------

describe("registerPluginAtomicAction, register-atomic-success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bootstrap token and CLI command on success", async () => {
    mockRegisterPlugin.mockResolvedValue({ ...successResponse });

    const bindings = [
      { declaredName: "cred:api_key", mode: "existing", existingRef: "cred:my_key" },
    ];
    const result = await registerPluginAtomicAction(validManifest, bindings);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.bootstrapToken).toBe("bst_abc123");
    expect(result.data.enrollCommand).toContain("gibson-cli plugin enroll --token bst_abc123");
    expect(result.data.installId).toBe("install-uuid-1");

    // Must NOT be dry-run.
    const opts = mockRegisterPlugin.mock.calls[0][0];
    expect(opts.dryRun).toBe(false);

    expect(revalidatePath).toHaveBeenCalledWith(
      "/dashboard/plugins",
    );
  });

  it("encodes create_value bytes for inline-create bindings", async () => {
    mockRegisterPlugin.mockResolvedValue({ ...successResponse });

    const bindings = [
      {
        declaredName: "cred:db_pass",
        mode: "create",
        createValue: "my-inline-secret",
      },
    ];
    await registerPluginAtomicAction(validManifest, bindings);

    const opts = mockRegisterPlugin.mock.calls[0][0];
    const binding = opts.bindings[0];
    // Value must be bytes, not a string.
    expect(Buffer.from(binding.createValue).toString()).toBe("my-inline-secret");
  });
});

describe("registerPluginAtomicAction, register-atomic-rollback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns manifest_invalid code on invalid_argument error", async () => {
    mockRegisterPlugin.mockRejectedValue(
      Object.assign(new Error("field spec.methods is required"), {
        code: "invalid_argument",
      }),
    );

    const result = await registerPluginAtomicAction(validManifest, []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    // Wizard can navigate to Step 1 (manifest upload).
    expect(result.code).toBe("manifest_invalid");
    // No revalidatePath on failure.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns binding_failed code when daemon reports secret/broker failure", async () => {
    mockRegisterPlugin.mockRejectedValue(
      Object.assign(
        new Error("failed to create inline secret: broker not configured"),
        { code: "failed_precondition" },
      ),
    );

    const result = await registerPluginAtomicAction(validManifest, []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    // Wizard can navigate to Step 3 (secret binding).
    expect(result.code).toBe("binding_failed");
  });

  it("returns already_registered when plugin is already enrolled", async () => {
    mockRegisterPlugin.mockRejectedValue(
      Object.assign(new Error("plugin already registered"), {
        code: "already_exists",
      }),
    );

    const result = await registerPluginAtomicAction(validManifest, []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("already_registered");
  });
});

describe("registerPluginAtomicAction, validation errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns bad_input for empty manifest", async () => {
    const result = await registerPluginAtomicAction("", []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });

  it("returns bad_input for invalid bindings", async () => {
    const badBindings = [{ declaredName: "", mode: "unknown" }];
    const result = await registerPluginAtomicAction(validManifest, badBindings);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("bad_input");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });

  it("returns manifest_invalid when response contains validation errors", async () => {
    mockRegisterPlugin.mockResolvedValue({
      ...successResponse,
      validationErrors: [validationError],
    });

    const result = await registerPluginAtomicAction(validManifest, []);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("manifest_invalid");
    expect(result.error).toContain("line 8");
  });
});

describe("registerPluginAtomicAction, unauthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetServerSession.mockResolvedValueOnce(null as any);
  });

  it("returns unauthenticated when no session", async () => {
    const result = await registerPluginAtomicAction(validManifest, []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("unauthenticated");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assertAuthorized gating
// ---------------------------------------------------------------------------

describe("validatePluginManifestAction, authz denied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.PluginAdminService/RegisterPlugin",
        "relation-not-met",
      ),
    );
  });

  it("returns permission_denied without calling daemon", async () => {
    const result = await validatePluginManifestAction(validManifest);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });
});

describe("registerPluginAtomicAction, authz denied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.PluginAdminService/RegisterPlugin",
        "relation-not-met",
      ),
    );
  });

  it("returns permission_denied without calling daemon", async () => {
    const result = await registerPluginAtomicAction(validManifest, []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockRegisterPlugin).not.toHaveBeenCalled();
  });
});
