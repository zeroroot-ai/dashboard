import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/auth/assert-authorized", () => ({
  assertAuthorized: vi.fn().mockResolvedValue(undefined),
  AuthzDeniedError: class AuthzDeniedError extends Error {},
}));

const mockCreateMissionDefinition = vi.fn();
const mockUpdateMissionDefinition = vi.fn();
const mockCreateMission = vi.fn();
const mockValidateMissionCUE = vi.fn();
const mockCreateTarget = vi.fn();

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({
    validateMissionCUE: mockValidateMissionCUE,
    createMissionDefinition: mockCreateMissionDefinition,
    updateMissionDefinition: mockUpdateMissionDefinition,
    createMission: mockCreateMission,
    createTarget: mockCreateTarget,
  })),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { createMissionFromCUEAction } from "../create-mission";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CUE = `package mission\n\nmission: {\n  name: "my-mission"\n}`;

const COMPILED_DEF = {
  name: "my-mission",
  targetRef: "target-1",
};

function makeValidateOk() {
  mockValidateMissionCUE.mockResolvedValue({
    diagnostics: [],
    compiledDefinition: COMPILED_DEF,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMissionFromCUEAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeValidateOk();
    // COMPILED_DEF.targetRef is a non-UUID, so the pre-step mints a target.
    mockCreateTarget.mockResolvedValue({ targetId: "11111111-1111-1111-1111-111111111111" });
  });

  it("succeeds end-to-end: validate → create definition → create mission", async () => {
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-001" });
    mockCreateMission.mockResolvedValue({ success: true, mission: { id: "run-001" } });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.missionId).toBe("run-001");
    expect(mockCreateMissionDefinition).toHaveBeenCalledOnce();
    expect(mockCreateMission).toHaveBeenCalledOnce();
  });

  it("passes the raw cueSource to CreateMissionDefinition so the daemon persists it", async () => {
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-001" });
    mockCreateMission.mockResolvedValue({ success: true, mission: { id: "run-001" } });

    await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(mockCreateMissionDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ cueSource: VALID_CUE }),
    );
  });

  it("is iteration-safe: AlreadyExists falls back to UpdateMissionDefinition in place", async () => {
    mockCreateMissionDefinition.mockRejectedValue(
      new ConnectError("already exists", Code.AlreadyExists),
    );
    mockUpdateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-stable" });
    mockCreateMission.mockResolvedValue({ success: true, mission: { id: "run-002" } });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.missionId).toBe("run-002");
    // The edited CUE is written in place, not rejected.
    expect(mockUpdateMissionDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ cueSource: VALID_CUE }),
    );
    expect(mockCreateMission).toHaveBeenCalledOnce();
  });

  it("returns rpc_failed on generic ConnectError from CreateMissionDefinition", async () => {
    mockCreateMissionDefinition.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("rpc_failed");
  });

  it("returns invalid when ValidateMissionCUE returns diagnostics", async () => {
    mockValidateMissionCUE.mockResolvedValue({
      diagnostics: [{ message: "missing mission field" }],
      compiledDefinition: null,
    });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid");
      expect(result.error).toBe("missing mission field");
    }
    expect(mockCreateMissionDefinition).not.toHaveBeenCalled();
  });

  it("mints a target from a non-UUID targetRef and sends the minted UUID as target_id", async () => {
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-001" });
    mockCreateMission.mockResolvedValue({ success: true, mission: { id: "run-003" } });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(true);
    // targetRef "target-1" (a name) is minted into a target, not sent as an id.
    expect(mockCreateTarget).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ name: "target-1" }) }),
    );
    expect(mockCreateMission).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "11111111-1111-1111-1111-111111111111" }),
    );
  });

  it("uses targetRef directly when it is already a UUID (no mint)", async () => {
    mockValidateMissionCUE.mockResolvedValue({
      diagnostics: [],
      compiledDefinition: {
        name: "my-mission",
        targetRef: "22222222-2222-2222-2222-222222222222",
      },
    });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-001" });
    mockCreateMission.mockResolvedValue({ success: true, mission: { id: "run-004" } });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(true);
    expect(mockCreateTarget).not.toHaveBeenCalled();
    expect(mockCreateMission).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "22222222-2222-2222-2222-222222222222" }),
    );
  });

  it("returns invalid with a clear message when no target is attached", async () => {
    mockValidateMissionCUE.mockResolvedValue({
      diagnostics: [],
      compiledDefinition: { name: "my-mission", targetRef: "" },
    });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: "def-001" });

    const result = await createMissionFromCUEAction({ cueSource: VALID_CUE });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid");
      expect(result.error).toMatch(/attach a target/i);
    }
    // Never leaks a name into target_id.
    expect(mockCreateMission).not.toHaveBeenCalled();
  });
});
