"use server";

/**
 * Server Actions for chat conversation management.
 *
 * generateConversationTitle, fires a non-streaming LLM call to produce a
 * ≤6-word title from the first exchange. Called fire-and-forget from useChat
 * after the first assistant turn completes; never blocks the UI render path.
 *
 * renameConversation, user-initiated title update; persists via daemon
 * RenameConversation RPC. Direct Redis conversation writes were removed in
 * dashboard#549; auto-title Redis writes removed in dashboard#551.
 *
 * deleteConversationAction, removes a conversation permanently via the daemon
 * DeleteConversation RPC (added in dashboard#551 / gibson PR #550).
 *
 * loadConversationMessages, fetches the full message list for a conversation
 * from the daemon via GetConversation and converts proto parts → UIMessage[].
 * Called by useChat.switchConversation when the conversation has no in-memory
 * messages (post-reload state). Also surfaces interrupted trailing assistant
 * messages cleanly, they load as normal completed messages with regenerate
 * available (dashboard#555).
 *
 * Spec: dashboard#448 (auto-title), dashboard#435 (rename thread),
 *       dashboard#551 (delete), dashboard#555 (reload/switch correctness)
 */

import "server-only";

import { generateText } from "ai";
import type { UIMessage } from "ai";
import { getServerSession } from "@/src/lib/auth";
import { requireActiveTenant, activeTenantActionResult } from "@/src/lib/auth/active-tenant";
import { resolveProvider } from "@/src/lib/ai/provider";
import {
  listProviders,
  saveConversation,
  renameConversation as rpcRenameConversation,
  deleteConversation as rpcDeleteConversation,
  getConversation,
} from "@/src/lib/gibson-client";
import { protoToUiMessages } from "@/src/lib/chat/message-normalizer";
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

    // tenantId empty, daemon resolves from authenticated identity.
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

    // tenantId empty, daemon resolves from authenticated identity.
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
 * (`uiMessagesToProto`) before sending, ensuring all part types (tool calls,
 * citations, attachments, reasoning) are preserved losslessly.
 *
 * Returns `true` on success, `false` when the session is absent, tenantId is
 * missing, or the RPC fails. The caller should treat a `false` return as a
 * silent degradation, the conversation remains in Zustand in-memory state.
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
    // RPC failures are degraded, the conversation stays in Zustand.
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

    let tenantId: string;
    try {
      tenantId = await requireActiveTenant();
    } catch {
      return null;
    }
    const userId = session.user.id ?? "";

    // Resolve the default LLM provider, same path as /api/chat route.
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

    // Best-effort RPC update, failures are logged and silently swallowed
    // so the caller never sees an error. tenantId empty, daemon resolves
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
    // Swallow all errors, this action is fire-and-forget; it must never
    // surface an exception to the client render path.
    return null;
  }
}

/**
 * Load the full message history for a conversation from the daemon.
 *
 * Called by `useChat.switchConversation` when the in-memory message list is
 * empty (the normal post-reload state after `ConversationListProvider` hydrates
 * only conversation metadata, not full message history).
 *
 * Converts proto ConversationMessage parts → AI SDK v6 `UIMessage[]` via the
 * canonical `protoToUiMessages` normalizer so all part types (tool calls,
 * citations, attachments, reasoning) are preserved losslessly.
 *
 * If the conversation's trailing message is an assistant message that was
 * persisted mid-stream (e.g. via the stop+persist path from dashboard#563),
 * it loads as a normal completed message, no spinner state, no duplication.
 * Regenerate is available on all assistant messages via the existing #564 UX.
 *
 * Returns `null` on any error (session absent, conversation not found, daemon
 * unreachable). Callers should treat null as "keep the empty message list" and
 * not surface an error, degraded to empty is acceptable.
 *
 * Spec: dashboard#555 (finalize interrupted streams on reload)
 */
export async function loadConversationMessages(
  conversationId: string,
): Promise<UIMessage[] | null> {
  if (!conversationId) return null;

  try {
    const session = await getServerSession();
    if (!session) return null;

    const { messages: protoMessages } = await getConversation(conversationId);
    // protoToUiMessages takes ConversationMessage[] from the proto; the RPC client
    // wrapper returns ConversationMessageRecord[] which carries the same id/role/parts
    // fields, the fields protoToUiMessage actually reads. The createdAtUnix field
    // is unused by the normalizer. The cast is structurally safe and avoids leaking
    // proto types through the gibson-client wrapper boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return protoToUiMessages(protoMessages as any);
  } catch (err) {
    logger.warn({ err, conversationId }, "[chat] loadConversationMessages: RPC failed");
    return null;
  }
}
