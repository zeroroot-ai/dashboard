/**
 * Conversation export utilities.
 *
 * Pure functions, no I/O, no side effects. The caller is responsible for
 * triggering the download (browser-side blob + anchor click).
 */

import type { UIMessage } from 'ai';
import type { Conversation } from '@/src/stores/chat-store';

/** Extract the first text content from a UIMessage's parts array. */
function messageText(msg: UIMessage): string {
  for (const part of msg.parts) {
    if (part.type === 'text') return part.text;
  }
  return '';
}

function roleLabel(role: UIMessage['role']): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    default:
      return role;
  }
}

/**
 * Render a conversation as Markdown.
 *
 * Format:
 * ```
 * # <title>
 * _Exported: <datetime>_
 *
 * ---
 *
 * **User**
 *
 * <text>
 *
 * ---
 *
 * **Assistant**
 *
 * <text>
 * ```
 */
export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [];
  const title = conv.title || 'Conversation';
  lines.push(`# ${title}`);
  lines.push(`_Exported: ${new Date().toUTCString()}_`);
  lines.push('');

  for (const msg of conv.messages) {
    if (msg.role === 'system') continue;
    const text = messageText(msg);
    if (!text) continue;
    lines.push('---');
    lines.push('');
    lines.push(`**${roleLabel(msg.role)}**`);
    lines.push('');
    lines.push(text);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render a conversation as plain text.
 *
 * Format:
 * ```
 * <title>
 * Exported: <datetime>
 *
 * ────────────────────────────────────
 * User:
 * <text>
 *
 * ────────────────────────────────────
 * Assistant:
 * <text>
 * ```
 */
export function conversationToPlaintext(conv: Conversation): string {
  const lines: string[] = [];
  const title = conv.title || 'Conversation';
  const divider = '─'.repeat(40);
  lines.push(title);
  lines.push(`Exported: ${new Date().toUTCString()}`);
  lines.push('');

  for (const msg of conv.messages) {
    if (msg.role === 'system') continue;
    const text = messageText(msg);
    if (!text) continue;
    lines.push(divider);
    lines.push(`${roleLabel(msg.role)}:`);
    lines.push(text);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Trigger a browser download of the given text content.
 * Safe to call only on the client side.
 */
export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Sanitise a conversation title into a safe filename stem. */
export function titleToFilename(title: string): string {
  return (title || 'conversation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
