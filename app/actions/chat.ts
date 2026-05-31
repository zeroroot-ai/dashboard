"use server";

/**
 * Server Actions for chat conversation management.
 *
 * generateConversationTitle — fires a non-streaming LLM call to produce a
 * ≤6-word title from the first exchange. Called fire-and-forget from useChat
 * after the first assistant turn completes; never blocks the UI render path.
 *
 * renameConversation — user-initiated title update; persists to Redis.
 *
 * Spec: dashboard#448 (auto-title), dashboard#435 (rename thread)
 */

import "server-only";

import { generateText } from "ai";
import { getServerSession } from "@/src/lib/auth";
import { resolveProvider } from "@/src/lib/ai/provider";
import { listProviders, saveConversation } from "@/src/lib/gibson-client";
import { updateConversationTitle } from "@/src/lib/redis-store";

/**
 * Generate a ≤6-word title from the first user/assistant exchange and
 * persist it to Redis.
 *
 * Returns the generated title string on success, or `null` when:
 *  - the session is absent
 *  - no LLM provider is configured
 *  - the LLM returns an empty response
 *  - Redis is unavailable (title update silently degrades)
 *
 * The caller is expected to use `void generateConversationTitle(...).then(...)`
 * so it never blocks the render path.
 */
/**
 * Persist a user-supplied conversation title to Redis.
 *
 * Returns `true` on success, `false` when the session is absent, tenantId is
 * missing, or Redis is unavailable. The caller should update the Zustand store
 * optimistically and treat a `false` return as a silent degradation.
 */
export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<boolean> {
  try {
    const session = await getServerSession();
    if (!session) return false;

    const tenantId = session.user.tenantId ?? '';
    if (!tenantId) return false;

    const trimmed = title.trim().slice(0, 500);
    if (!trimmed) return false;

    return await updateConversationTitle(tenantId, conversationId, trimmed);
  } catch {
    return false;
  }
}

/**
 * Persist a conversation and its messages via the daemon SaveConversation RPC.
 *
 * Returns `true` on success, `false` when the session is absent, tenantId is
 * missing, or the RPC fails. The caller should treat a `false` return as a
 * silent degradation — the conversation remains in Zustand in-memory state.
 *
 * This is the only sanctioned conversation write path on the dashboard.
 * Dashboard direct-Redis conversation writes were removed in dashboard#549.
 */
export async function saveConversationAction(
  conversationId: string,
  title: string,
  messages: { id: string; role: string; content: string; createdAtUnix?: number }[],
  agentId = "",
): Promise<boolean> {
  try {
    const session = await getServerSession();
    if (!session) return false;

    if (!conversationId) return false;
    if (messages.length === 0) return false;

    await saveConversation(conversationId, title, messages, agentId);
    return true;
  } catch (err) {
    // RPC failures are degraded — the conversation stays in Zustand.
    // Log at warn so operators can spot connectivity gaps without surfacing
    // errors to users.
    const { logger } = await import("@/src/lib/logger");
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

    // Best-effort Redis update — failures are logged by redis-store and
    // silently swallowed here so the caller never sees an error.
    await updateConversationTitle(tenantId, conversationId, title);

    return title;
  } catch {
    // Swallow all errors — this action is fire-and-forget; it must never
    // surface an exception to the client render path.
    return null;
  }
}
