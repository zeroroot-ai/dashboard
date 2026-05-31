/**
 * Unit tests for app/actions/chat.ts — rename + delete RPC wiring.
 *
 * Verifies that:
 *  - renameConversation calls RenameConversation RPC with the right args
 *  - deleteConversationAction calls DeleteConversation RPC
 *  - both return false when the session is absent
 *  - both return false and log when the RPC throws
 *
 * Spec: dashboard#551
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must be declared before vi.mock() calls.
// ---------------------------------------------------------------------------

const {
  mockRenameConversation,
  mockDeleteConversation,
  mockGetServerSession,
} = vi.hoisted(() => ({
  mockRenameConversation: vi.fn(async () => undefined as void),
  mockDeleteConversation: vi.fn(async () => undefined as void),
  mockGetServerSession: vi.fn(async () => ({
    user: { id: "user-1", tenantId: "tenant-abc" },
  })),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/gibson-client", () => ({
  renameConversation: mockRenameConversation,
  deleteConversation: mockDeleteConversation,
  // saveConversation + listProviders stubs for generateConversationTitle path
  saveConversation: vi.fn(async () => undefined),
  listProviders: vi.fn(async () => ({ providers: [], defaultProvider: null })),
}));

// generateText stub — not needed for rename/delete tests but prevents import
// errors from the 'ai' package in the server-only module graph.
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "" })),
}));

vi.mock("@/src/lib/ai/provider", () => ({
  resolveProvider: vi.fn(() => ({})),
}));

vi.mock("@/src/lib/chat/message-normalizer", () => ({
  uiMessagesToProto: vi.fn(() => []),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import { renameConversation, deleteConversationAction } from "../chat";
import { logger } from "@/src/lib/logger";

// ---------------------------------------------------------------------------
// renameConversation
// ---------------------------------------------------------------------------

describe("renameConversation — RPC wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls RenameConversation RPC with conversationId and trimmed title", async () => {
    const result = await renameConversation("conv-1", "  My Title  ");
    expect(result).toBe(true);
    expect(mockRenameConversation).toHaveBeenCalledOnce();
    expect(mockRenameConversation).toHaveBeenCalledWith("conv-1", "My Title");
  });

  it("returns false and does not call RPC when title trims to empty", async () => {
    const result = await renameConversation("conv-1", "   ");
    expect(result).toBe(false);
    expect(mockRenameConversation).not.toHaveBeenCalled();
  });

  it("returns false when session is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetServerSession.mockResolvedValueOnce(null as any);
    const result = await renameConversation("conv-1", "Title");
    expect(result).toBe(false);
    expect(mockRenameConversation).not.toHaveBeenCalled();
  });

  it("returns false and logs when RPC throws", async () => {
    mockRenameConversation.mockRejectedValueOnce(new Error("RPC error"));
    const result = await renameConversation("conv-1", "Title");
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deleteConversationAction
// ---------------------------------------------------------------------------

describe("deleteConversationAction — RPC wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls DeleteConversation RPC with conversationId", async () => {
    const result = await deleteConversationAction("conv-2");
    expect(result).toBe(true);
    expect(mockDeleteConversation).toHaveBeenCalledOnce();
    expect(mockDeleteConversation).toHaveBeenCalledWith("conv-2");
  });

  it("returns false when session is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetServerSession.mockResolvedValueOnce(null as any);
    const result = await deleteConversationAction("conv-2");
    expect(result).toBe(false);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it("returns false when conversationId is empty", async () => {
    const result = await deleteConversationAction("");
    expect(result).toBe(false);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });

  it("returns false and logs when RPC throws", async () => {
    mockDeleteConversation.mockRejectedValueOnce(new Error("RPC error"));
    const result = await deleteConversationAction("conv-2");
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
