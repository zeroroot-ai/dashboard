"use server";

/**
 * Server Actions for chat conversation management.
 *
 * generateConversationTitle — fires a non-streaming LLM call to produce a
 * ≤6-word title from the first exchange. Called fire-and-forget from useChat
 * after the first assistant turn completes; never blocks the UI render path.
 *
 * renameConversation — user-initiated title update; persists via daemon
 * RenameConversation RPC. Direct Redis conversation writes were removed in
 * dashboard#549; auto-title Redis writes removed in dashboard#551.
 *
 * deleteConversationAction — removes a conversation permanently via the daemon
 * DeleteConversation RPC (added in dashboard#551 / gibson PR #550).
 *
 * Spec: dashboard#448 (auto-title), dashboard#435 (rename thread), dashboard#551 (delete)
 */

import "server-only";

import { generateText } from "ai";
import type { UIMessage } from "ai";
import { getServerSession } from "@/src/lib/auth";
import { resolveProvider } from "@/src/lib/ai/provider";
import {
  listProviders,
  saveConversation,
  renameConversation as rpcRenameConversation,
  deleteConversation as rpcDeleteConversation,
} from "@/src/lib/gibson-client";
import { uiMessagesToProto } from "@/src/lib/chat/message-normalizer";
import { logger } from "@/src/lib/logger";

/**
 * Persist a user-supplied conversation title via the daemon RenameConversation RPC.
 *
 * Returns `true` on success, `false` when the session is absent, tenantId is
 * missing, or the RPC fails. The caller should update the Zustand store
 * optimistically and treat a `false` return as a silent degradation.
 */
export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<boolean> {
  try {
    const session = await getServerSession();
    if (!session) return false;

    const trimmed = title.trim().slice(0, 500);
    if (!trimmed) return false;

    // tenantId empty — daemon resolves from authenticated identity.
    await rpcRenameConversation(conversationId, trimmed);
    return true;
  } catch (err) {
    logger.warn({ err, conversationId }, "[chat] renameConversation: RPC failed");
    return false;
  }
}

/**
 * Delete a conversation permanently via the daemon DeleteConversation RPC.
 *
 * Returns `true` on success, `false` when the session is absent or the RPC
 * fails. The caller should update the Zustand store optimistically and revert
 * on `false`.
 *
 * The daemon resolves ownership from the authenticated identity; no `user_id`
 * is sent in the request (see RPC shape: DeleteConversationRequest).
 */
export async function deleteConversationAction(
  conversationId: string,
): Promise<boolean> {
  try {
    const session = await getServerSession();
    if (!session) return false;

    if (!conversationId) return false;

    // tenantId empty — daemon resolves from authenticated identity.
    await rpcDeleteConversation(conversationId);
    return true;
  } catch (err) {
    logger.warn({ err, conversationId }, "[chat] deleteConversationAction: RPC failed");
    return false;
  }
}

/**
 * Persist a conversation and its messages via the daemon SaveConversation RPC.
 *
 * `messages` is the AI SDK v6 `UIMessage[]` array from the chat store. The
 * action converts it to proto parts via the canonical message normalizer
 * (`uiMessagesToProto`) before sending — ensuring all part types (tool calls,
 * citations, attachments, reasoning) are preserved losslessly.
 *
 * Returns `true` on success, `false` when the session is absent, tenantId is
 * missing, or the RPC fails. The caller should treat a `false` return as a
 * silent degradation — the conversation remains in Zustand in-memory state.
 *
 * This is the only sanctioned conversation write path on the dashboard.
 * Dashboard direct-Redis conversation writes were removed in dashboard#549.
 * Flat-text message mapping was replaced by the parts normalizer in dashboard#550.
 */
export async function saveConversationAction(
  conversationId: string,
  title: string,
  messages: UIMessage[],
  agentId = "",
): Promise<boolean> {
  try {
    const session = await getServerSession();
    if (!session) return false;

    if (!conversationId) return false;
    if (messages.length === 0) return false;

    // Convert UIMessage[] → proto parts via the canonical normalizer.
    const protoMessages = uiMessagesToProto(messages);

    await saveConversation(conversationId, title, protoMessages, agentId);
    return true;
  } catch (err) {
    // RPC failures are degraded — the conversation stays in Zustand.
    // Log at warn so operators can spot connectivity gaps without surfacing
    // errors to users.
    logger.warn({ err, conversationId }, "[chat] saveConversationAction: RPC failed");
    return false;
  }
}

export async function generateConversationTitle(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<string | null> {
  try {
    const session = await getServerSession();
    if (!session) return null;

    const tenantId = session.user.tenantId ?? "";
    const userId = session.user.id ?? "";
    if (!tenantId) return null;

    // Resolve the default LLM provider — same path as /api/chat route.
    let providerName: string;
    try {
      const providerList = await listProviders(tenantId, userId);
      const defaultName = providerList.defaultProvider;
      if (!defaultName) return null;
      providerName = defaultName;
    } catch {
      return null;
    }

    const model = resolveProvider(providerName, { userId, tenantId });

    // Truncate inputs so the title prompt stays well within context limits.
    const userSnippet = userMessage.slice(0, 500);
    const assistantSnippet = assistantMessage.slice(0, 500);

    const prompt =
      `Summarise this conversation in 6 words or fewer. ` +
      `Reply with ONLY the title, no punctuation.\n\n` +
      `User: ${userSnippet}\nAssistant: ${assistantSnippet}`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 20,
    });

    const title = text.trim();
    if (!title) return null;

    // Best-effort RPC update — failures are logged and silently swallowed
    // so the caller never sees an error. tenantId empty — daemon resolves
    // from authenticated identity.
    try {
      await rpcRenameConversation(conversationId, title);
    } catch (err) {
      logger.warn(
        { err, conversationId },
        "[chat] generateConversationTitle: RenameConversation RPC failed",
      );
    }

    return title;
  } catch {
    // Swallow all errors — this action is fire-and-forget; it must never
    // surface an exception to the client render path.
    return null;
  }
}
