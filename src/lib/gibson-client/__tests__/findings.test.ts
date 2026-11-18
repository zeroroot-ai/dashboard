// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

const client = { getFinding: vi.fn(), exportFindings: vi.fn() };
vi.mock("@/src/lib/gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("../../gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("@/src/gen/gibson/tenant/v1/tenant_pb", () => ({ TenantService: {} }));
vi.mock("@/src/gen/gibson/types/v1/types_pb", () => ({
  EvidenceTier: { UNSPECIFIED: 0, RECORDED: 1, TYPED: 2 },
  EvidenceType: {
    UNSPECIFIED: 0,
    REQUEST: 1,
    RESPONSE: 2,
    SCREENSHOT: 3,
    CODE: 4,
    LOG: 5,
    OTHER: 6,
    PAYLOAD: 7,
    CONVERSATION: 8,
    NETWORK_TRACE: 9,
  },
}));

import { daemonExportFindings, daemonGetFinding } from "../findings";

const ev = (over: Record<string, unknown> = {}) => ({
  title: "t",
  type: 1,
  content: "c",
  metadata: { k: "v" },
  tier: 1,
  toolCallId: "call-1",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("daemonGetFinding", () => {
  it("asks for one finding by id and maps the fields", async () => {
    client.getFinding.mockResolvedValue({
      finding: {
        id: "f1",
        title: "SQLi",
        description: "d",
        category: "injection",
        severity: "high",
        confidence: 0.9,
        missionId: "m1",
        agentName: "scout",
        submittedBy: "agent:1",
        createdAt: { seconds: BigInt(1_700_000_000), nanos: 0 },
        evidence: [ev()],
      },
    });
    const out = await daemonGetFinding("f1");
    expect(client.getFinding).toHaveBeenCalledWith({ findingId: "f1" });
    expect(out).toMatchObject({
      id: "f1",
      title: "SQLi",
      severity: "high",
      confidence: 0.9,
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("keeps the stored order of the evidence and every item, with type, tier and tool call", async () => {
    client.getFinding.mockResolvedValue({
      finding: {
        id: "f1",
        title: "",
        description: "",
        category: "",
        severity: "",
        confidence: 0,
        missionId: "",
        agentName: "",
        submittedBy: "",
        evidence: [
          ev({ title: "first", type: 8, tier: 1, toolCallId: "a" }),
          ev({ title: "second", type: 9, tier: 2, toolCallId: "" }),
          ev({ title: "third", type: 99, tier: 0, toolCallId: "" }),
        ],
      },
    });
    const out = await daemonGetFinding("f1");
    expect(out!.evidence.map((e) => [e.title, e.kind, e.tier, e.toolCallId])).toEqual([
      ["first", "conversation", "recorded", "a"],
      ["second", "network_trace", "typed", ""],
      ["third", "unspecified", "unknown", ""],
    ]);
    expect(out!.createdAt).toBe("");
  });

  it("does not cut a long content", async () => {
    const big = "z".repeat(1_500_000);
    client.getFinding.mockResolvedValue({ finding: { id: "f", evidence: [ev({ content: big })] } });
    expect((await daemonGetFinding("f"))!.evidence[0].content).toHaveLength(1_500_000);
  });

  it("returns null when the response holds no finding, and lets an error reach the caller", async () => {
    client.getFinding.mockResolvedValueOnce({ finding: undefined });
    expect(await daemonGetFinding("f")).toBeNull();
    const err = new ConnectError("nope", Code.NotFound);
    client.getFinding.mockRejectedValueOnce(err);
    await expect(daemonGetFinding("f")).rejects.toBe(err);
  });
});

describe("daemonExportFindings", () => {
  it("passes include_evidence and the ids, and decodes the file", async () => {
    client.exportFindings.mockResolvedValue({
      data: new TextEncoder().encode('{"findings":[]}'),
      format: "json",
      filename: "findings.json",
      count: 2,
    });
    const out = await daemonExportFindings({ format: "json", findingIds: ["a", "b"], includeEvidence: true });
    expect(client.exportFindings).toHaveBeenCalledWith({
      format: "json",
      findingIds: ["a", "b"],
      includeEvidence: true,
    });
    expect(out).toEqual({ filename: "findings.json", format: "json", count: 2, text: '{"findings":[]}' });
  });
});
