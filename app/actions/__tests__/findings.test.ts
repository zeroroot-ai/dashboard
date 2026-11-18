// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

const m = vi.hoisted(() => ({ get: vi.fn(), exp: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: m.session }));
vi.mock("@/src/lib/gibson-client/findings", () => ({
  daemonGetFinding: m.get,
  daemonExportFindings: m.exp,
}));

import { exportFindingsAction, getFindingAction } from "../findings";

const ID = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
});

describe("getFindingAction", () => {
  it("needs a session", async () => {
    m.session.mockResolvedValue(null);
    expect(await getFindingAction(ID)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(m.get).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID before the call", async () => {
    expect(await getFindingAction("x'; drop")).toMatchObject({ ok: false, code: "bad_input" });
    expect(m.get).not.toHaveBeenCalled();
  });

  it("returns the finding", async () => {
    m.get.mockResolvedValue({ id: ID, evidence: [] });
    expect(await getFindingAction(` ${ID} `)).toEqual({ ok: true, data: { id: ID, evidence: [] } });
    expect(m.get).toHaveBeenCalledWith(ID);
  });

  it("maps NotFound and an empty response to not_found", async () => {
    m.get.mockRejectedValueOnce(new ConnectError("x", Code.NotFound));
    expect(await getFindingAction(ID)).toMatchObject({ ok: false, code: "not_found" });
    m.get.mockResolvedValueOnce(null);
    expect(await getFindingAction(ID)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("hides the text of an internal failure", async () => {
    m.get.mockRejectedValue(new ConnectError("pq: connection to 10.0.0.9 refused", Code.Internal));
    const r = await getFindingAction(ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("10.0.0.9");
  });
});

describe("exportFindingsAction", () => {
  it("passes include_evidence to the daemon call", async () => {
    m.exp.mockResolvedValue({ filename: "f.json", format: "json", count: 1, text: "{}" });
    const r = await exportFindingsAction({ format: "json", findingIds: [ID], includeEvidence: true });
    expect(r.ok).toBe(true);
    expect(m.exp).toHaveBeenCalledWith({ format: "json", findingIds: [ID], includeEvidence: true });
  });

  it("refuses an empty selection, an unknown format and a bad id", async () => {
    for (const input of [
      { format: "json", findingIds: [], includeEvidence: true },
      { format: "xml", findingIds: [ID], includeEvidence: false },
      { format: "json", findingIds: ["nope"], includeEvidence: false },
    ]) {
      expect(await exportFindingsAction(input)).toMatchObject({ ok: false, code: "bad_input" });
    }
    expect(m.exp).not.toHaveBeenCalled();
  });
});
